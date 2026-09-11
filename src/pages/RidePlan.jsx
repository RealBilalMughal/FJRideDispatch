import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ChevronLeft, ChevronRight, Download, RefreshCw, Sigma, Upload } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { useCity } from '../context/useCity'
import { fmtDate } from '../lib/format'
import { addDays, fmtTime12, pkToday } from '../lib/time'
import { blockLabel } from '../lib/rideRoute'
import { checkHeaders, downloadCsv, parseCsvObjects, toCsv } from '../lib/csv'
import { PLAN_REQUIRED_COLUMNS, buildPlanRows } from '../lib/planImport'
import Modal from '../components/Modal'
import DataTable from '../components/data/DataTable'
import Pagination from '../components/data/Pagination'
import '../components/data/data.css'
import './RidePlan.css'

const PAGE_SIZE = 20

const SAMPLE_COLS = PLAN_REQUIRED_COLUMNS.map((key) => ({ key, label: key }))
const SAMPLE = [
  {
    date: '2026-09-08',
    base: 'LHE',
    car: 'AUK-980',
    'ad-hoc car': 'No',
    'block type': 'deadhead',
    'trip id': '2026-09-08_1',
    'flight no': '',
    origin: '',
    destination: '',
    'start time': '05:00',
    'end time': '05:39',
    'distance (km)': '26.9',
    'crew count': '',
    crew: '',
  },
  {
    date: '2026-09-08',
    base: 'LHE',
    car: 'AUK-980',
    'ad-hoc car': 'No',
    'block type': 'pickup',
    'trip id': '2026-09-08_1',
    'flight no': '9P841',
    origin: 'LHE',
    destination: 'KHI',
    'start time': '05:39',
    'end time': '06:30',
    'distance (km)': '33.8',
    'crew count': '3',
    crew: '107386 Arfa IJAZ (CC), 107807 Sumaiya Arshad (CC), 104718 Zamar SHAFIQUE (CS)',
  },
]

// A followed row's actual KM, same "cancelled and not counted -> 0" rule the
// Rides page and Dashboard use for every other KM total.
const billableKm = (ride) => {
  if (!ride) return null
  if (ride.status === 'cancelled' && !ride.count_km) return 0
  return ride.distance_km
}

const tierText = (tier) =>
  tier === 'employee_no' || tier === 'exact_name' ? '' : tier === 'fuzzy' ? ' · fuzzy match' : ' · unmatched'
const tierClass = (tier) => (tier === 'unmatched' ? 'bad' : tier === 'fuzzy' ? 'off' : '')

function CrewMatchCell({ matches, crew }) {
  if (!matches?.length) return <span className="secondary">—</span>
  return (
    <div className="crew-cell-stack">
      {matches.map((m, i) => {
        const c = crew.find((x) => x.id === m.crew_id)
        return (
          <div key={i}>
            {c?.name || m.name}
            {tierText(m.tier) && <span className={`status-text ${tierClass(m.tier)}`}>{tierText(m.tier)}</span>}
          </div>
        )
      })}
    </div>
  )
}

function StatusCell({ row }) {
  if (row.status === 'followed')
    return (
      <span className="status-text on">
        Followed{row.ride ? ` · ${row.ride.ref_no}` : ''}
      </span>
    )
  if (row.status === 'skipped')
    return (
      <span className="status-text bad" title={row.skip_reason || ''}>
        Skipped
      </span>
    )
  return <span className="status-text off">Pending</span>
}

export default function RidePlan() {
  const { can, profile } = useAuth()
  const { allowedCities, cityId, cityName } = useCity()
  const navigate = useNavigate()

  const canView = can('ride_plan', 'view')
  const canAdd = can('ride_plan', 'add')
  const canEdit = can('ride_plan', 'edit')

  const [planDate, setPlanDate] = useState(pkToday())
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [importOpen, setImportOpen] = useState(false)
  const [skipFor, setSkipFor] = useState(null)
  const [reportOpen, setReportOpen] = useState(false)

  const [flights, setFlights] = useState([])
  const [crew, setCrew] = useState([])
  const [vehicles, setVehicles] = useState([])

  useEffect(() => {
    if (!canView) return
    supabase
      .from('flights')
      .select('id, ref_no, flight_no, flight_code, route, block_type, flight_time, city_id, is_active')
      .then(({ data }) => setFlights((data ?? []).filter((f) => f.is_active)))
    supabase
      .from('crew')
      .select('id, ref_no, name, employee_no, city_id, is_active')
      .then(({ data }) => setCrew((data ?? []).filter((c) => c.is_active)))
    supabase
      .from('vehicles')
      .select('id, ref_no, vehicle_no, city_id, is_active')
      .then(({ data }) => setVehicles((data ?? []).filter((v) => v.is_active)))
  }, [canView])

  const fetchRows = useCallback(async () => {
    if (!canView) return
    setLoading(true)
    let q = supabase
      .from('ride_plan_rows')
      .select('*, ride:rides(id, ref_no, distance_km, status, count_km)')
      .eq('plan_date', planDate)
      .order('trip_id')
    if (cityId != null) q = q.eq('city_id', cityId)
    const { data, error } = await q
    if (error) toast.error('Could not load the plan')
    setRows(data ?? [])
    setLoading(false)
  }, [canView, planDate, cityId])

  useEffect(() => {
    fetchRows()
  }, [fetchRows])

  // Deadhead / Return Leg rows aren't dispatched directly - they ride along on
  // the ALREADY-BUILT "Also create a Deadhead" (Pickup) / "Create Ride ->
  // Return Leg" (Dropoff) features. Once this row's own Trip-ID sibling is
  // followed, check whether its companion ride now exists and auto-link it.
  const reconciling = useRef(false)
  useEffect(() => {
    if (!canEdit) return
    const siblingBlock = { deadhead: 'pickup', return_leg: 'dropoff' }
    const pending = rows.filter((r) => r.status === 'pending' && siblingBlock[r.block_type])
    if (!pending.length || reconciling.current) return
    reconciling.current = true
    ;(async () => {
      let changed = false
      for (const r of pending) {
        const sibling = rows.find(
          (s) => s.trip_id === r.trip_id && s.block_type === siblingBlock[r.block_type] && s.status === 'followed',
        )
        if (!sibling?.ride_id) continue
        const { data: companion } = await supabase
          .from('rides')
          .select('id')
          .eq('return_of_ride_id', sibling.ride_id)
          .eq('block_type', r.block_type)
          .maybeSingle()
        if (companion) {
          await supabase
            .from('ride_plan_rows')
            .update({ status: 'followed', ride_id: companion.id })
            .eq('id', r.id)
          changed = true
        }
      }
      reconciling.current = false
      if (changed) fetchRows()
    })()
  }, [rows, fetchRows, canEdit])

  const canFollow = (r) => r.status === 'pending' && (r.block_type === 'pickup' || r.block_type === 'dropoff')

  const doSkip = async (reason) => {
    if (!skipFor) return
    const { error } = await supabase
      .from('ride_plan_rows')
      .update({ status: 'skipped', skip_reason: reason.trim() || null })
      .eq('id', skipFor.id)
    if (error) return toast.error(error.message)
    setSkipFor(null)
    fetchRows()
  }

  const reopen = async (row) => {
    const { error } = await supabase
      .from('ride_plan_rows')
      .update({ status: 'pending', skip_reason: null })
      .eq('id', row.id)
    if (error) return toast.error(error.message)
    fetchRows()
  }

  const report = useMemo(() => {
    const byBlock = {}
    for (const r of rows) {
      const b = (byBlock[r.block_type] ??= { block: r.block_type, followed: 0, plannedKm: 0, actualKm: 0 })
      if (r.status !== 'followed') continue
      b.followed += 1
      b.plannedKm += Number(r.planned_km) || 0
      b.actualKm += Number(billableKm(r.ride)) || 0
    }
    return Object.values(byBlock)
  }, [rows])

  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const columns = [
    { key: 'trip', header: 'Trip', render: (r) => r.trip_id },
    { key: 'block', header: 'Block', render: (r) => blockLabel(r.block_type) },
    { key: 'flight', header: 'Flight', render: (r) => r.flight_no || '—' },
    {
      key: 'route',
      header: 'Route',
      render: (r) => (r.origin && r.destination ? `${r.origin} → ${r.destination}` : '—'),
    },
    {
      key: 'time',
      header: 'Time',
      render: (r) => `${fmtTime12(r.start_time) || '—'}${r.end_time ? ` – ${fmtTime12(r.end_time)}` : ''}`,
    },
    { key: 'km', header: 'Planned KM', align: 'right', render: (r) => (r.planned_km != null ? Number(r.planned_km).toFixed(2) : '—') },
    { key: 'crew', header: 'Crew', render: (r) => <CrewMatchCell matches={r.crew_matches} crew={crew} /> },
    {
      key: 'car',
      header: 'Vehicle',
      render: (r) => (
        <>
          {r.car || '—'}
          {r.is_adhoc_car && <span className="status-text off"> · ad-hoc</span>}
          {!r.is_adhoc_car && r.car && !r.matched_vehicle_id && <span className="status-text bad"> · not in fleet</span>}
        </>
      ),
    },
    { key: 'status', header: 'Status', render: (r) => <StatusCell row={r} /> },
    {
      key: 'actual',
      header: 'Actual KM',
      align: 'right',
      render: (r) => (r.status === 'followed' && r.ride ? (Number(billableKm(r.ride)) || 0).toFixed(2) : '—'),
    },
    {
      key: 'actions',
      header: 'Action',
      render: (r) => (
        <div className="row-actions">
          {canEdit && canFollow(r) && (
            <button
              type="button"
              className="btn btn-ghost btn-square btn-sm"
              onClick={() => navigate(`/rides?planRow=${r.id}`)}
            >
              Follow
            </button>
          )}
          {canEdit && r.status === 'pending' && (
            <button type="button" className="btn btn-ghost btn-square btn-sm" onClick={() => setSkipFor(r)}>
              Skip
            </button>
          )}
          {canEdit && r.status === 'skipped' && (
            <button type="button" className="btn btn-ghost btn-square btn-sm" onClick={() => reopen(r)}>
              Reopen
            </button>
          )}
        </div>
      ),
    },
  ]

  if (!canView) {
    return (
      <div className="page">
        <h1 className="page-title">Ride Plan</h1>
        <p className="page-subtitle">You don&rsquo;t have access to this page.</p>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Ride Plan</h1>
          <p className="page-subtitle">
            {rows.length} rows · {cityName}
          </p>
        </div>
        <div className="page-actions">
          <button className="icon-btn" onClick={fetchRows} title="Refresh">
            <RefreshCw size={15} />
          </button>
          <button
            className={`filter-toggle${reportOpen ? ' on' : ''}`}
            onClick={() => setReportOpen((v) => !v)}
          >
            <Sigma size={13} /> Report
          </button>
          {canAdd && (
            <button className="btn btn-ghost btn-square btn-sm" onClick={() => setImportOpen(true)}>
              <Upload size={14} /> Upload plan
            </button>
          )}
        </div>
      </div>

      <div className="rp-datebar">
        <button type="button" className="icon-btn" onClick={() => setPlanDate((d) => addDays(d, -1))}>
          <ChevronLeft size={16} />
        </button>
        <input
          type="date"
          className="input"
          value={planDate}
          onChange={(e) => {
            setPlanDate(e.target.value)
            setPage(1)
          }}
        />
        <span className="secondary">{fmtDate(planDate)}</span>
        <button type="button" className="icon-btn" onClick={() => setPlanDate((d) => addDays(d, 1))}>
          <ChevronRight size={16} />
        </button>
        {planDate !== pkToday() && (
          <button type="button" className="btn btn-ghost btn-square btn-sm" onClick={() => setPlanDate(pkToday())}>
            Today
          </button>
        )}
      </div>

      {reportOpen && (
        <div className="rp-report">
          <h3>Plan vs Actual · {fmtDate(planDate)}</h3>
          {report.length === 0 ? (
            <p className="secondary">No followed rows yet for this date.</p>
          ) : (
            <table className="data-table dense">
              <thead>
                <tr>
                  <th>Block</th>
                  <th>Followed</th>
                  <th>Planned KM</th>
                  <th>Actual KM</th>
                  <th>Δ</th>
                </tr>
              </thead>
              <tbody>
                {report.map((b) => (
                  <tr key={b.block}>
                    <td>{blockLabel(b.block)}</td>
                    <td>{b.followed}</td>
                    <td>{b.plannedKm.toFixed(2)}</td>
                    <td>{b.actualKm.toFixed(2)}</td>
                    <td className={b.actualKm - b.plannedKm > 0 ? 'status-text bad' : 'status-text on'}>
                      {(b.actualKm - b.plannedKm).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={pageRows}
        rowKey={(r) => r.id}
        loading={loading}
        emptyLabel="No plan uploaded for this date"
        title="Plan"
        subtitle={`${rows.length} shown`}
      />
      <Pagination page={page} pageSize={PAGE_SIZE} total={rows.length} onPage={setPage} />

      {importOpen && (
        <ImportModal
          allowedCities={allowedCities}
          flights={flights}
          crew={crew}
          vehicles={vehicles}
          cityId={cityId}
          createdBy={profile?.id}
          onClose={() => setImportOpen(false)}
          onDone={(earliestDate) => {
            setImportOpen(false)
            setPage(1)
            if (earliestDate && earliestDate !== planDate) setPlanDate(earliestDate)
            else fetchRows()
          }}
        />
      )}

      {skipFor && <SkipModal row={skipFor} onClose={() => setSkipFor(null)} onSkip={doSkip} />}
    </div>
  )
}

function SkipModal({ row, onClose, onSkip }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal open onClose={onClose} title={`Skip trip ${row.trip_id}`} width={420}>
      <div className="modal-form">
        <div className="field">
          <label htmlFor="skip-reason">Reason (optional)</label>
          <textarea
            id="skip-reason"
            className="input"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. flight cancelled, vehicle unavailable…"
            autoFocus
          />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-square"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await onSkip(reason)
              setBusy(false)
            }}
          >
            {busy ? 'Skipping…' : 'Skip'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function ImportModal({ allowedCities, flights, crew, vehicles, cityId, createdBy, onClose, onDone }) {
  const [parsed, setParsed] = useState(null) // { ok, skipped, warning }
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const downloadSample = () => downloadCsv('ride-plan-sample.csv', toCsv(SAMPLE_COLS, SAMPLE))

  const onFile = async (e) => {
    setErr('')
    setParsed(null)
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const { headers, records } = parseCsvObjects(text)
    const hc = checkHeaders(headers, PLAN_REQUIRED_COLUMNS, PLAN_REQUIRED_COLUMNS)
    if (!hc.ok) return setErr(hc.error)
    const { ok, skipped } = buildPlanRows(records, { allowedCities, flights, crew, vehicles })
    setParsed({ ok, skipped, warning: hc.warning })
  }

  const matchSummary = useMemo(() => {
    if (!parsed) return null
    let confirmed = 0
    let fuzzy = 0
    const unmatchedRows = []
    for (const r of parsed.ok) {
      for (const m of r.crew_matches) {
        if (m.tier === 'unmatched') unmatchedRows.push({ line: r.line, tripId: r.trip_id, raw: m.raw })
        else if (m.tier === 'fuzzy') fuzzy++
        else confirmed++
      }
    }
    return { confirmed, fuzzy, unmatched: unmatchedRows.length, unmatchedRows }
  }, [parsed])

  const runImport = async () => {
    if (!parsed?.ok.length) return
    setBusy(true)
    // the import batch's own city - the currently filtered city, else the most
    // common Base among the parsed rows (a plan can span more than one city)
    const counts = new Map()
    parsed.ok.forEach((r) => counts.set(r.city_id, (counts.get(r.city_id) || 0) + 1))
    const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    const importCityId = cityId ?? dominant

    const { data: imp, error: impErr } = await supabase
      .from('ride_plan_imports')
      .insert({ city_id: importCityId, file_name: null, row_count: parsed.ok.length, created_by: createdBy ?? null })
      .select('id')
      .single()
    if (impErr) {
      setBusy(false)
      return setErr(impErr.message)
    }
    const { error } = await supabase
      .from('ride_plan_rows')
      .insert(parsed.ok.map(({ line: _line, ...r }) => ({ ...r, import_id: imp.id })))
    setBusy(false)
    if (error) return setErr(error.message)
    toast.success(`${parsed.ok.length} plan rows imported`)
    const earliestDate = parsed.ok.map((r) => r.plan_date).sort()[0]
    onDone(earliestDate)
  }

  return (
    <Modal open onClose={onClose} title="Upload Ride Plan" width={520}>
      <div className="modal-form">
        {err && <div className="modal-error">{err}</div>}

        <p className="confirm-msg">
          Upload the plan as a CSV (Save As → CSV from Excel) with columns{' '}
          <b>Date, Base, Car, Ad-hoc Car, Block Type, Trip ID, Flight No, Origin, Destination, Start
          Time, End Time, Distance (km), Crew Count, Crew</b>. Crew cells are matched to the Crew page
          by Employee No first, then by name.
        </p>

        <button type="button" className="btn btn-ghost btn-square btn-sm" onClick={downloadSample}>
          <Download size={13} /> Download sample
        </button>

        <div className="field">
          <label htmlFor="plan-file">CSV file</label>
          <input id="plan-file" type="file" accept=".csv,text/csv" className="input" onChange={onFile} />
        </div>

        {parsed && (
          <div className="import-summary">
            {parsed.warning && <div className="field-error">{parsed.warning}</div>}
            <b>{parsed.ok.length}</b> rows ready
            {matchSummary && (
              <>
                {' · crew: '}
                <b>{matchSummary.confirmed}</b> matched
                {matchSummary.fuzzy > 0 && (
                  <>
                    {', '}
                    <span className="status-text off">{matchSummary.fuzzy} fuzzy</span>
                  </>
                )}
                {matchSummary.unmatched > 0 && (
                  <>
                    {', '}
                    <span className="status-text bad">{matchSummary.unmatched} unmatched</span>
                    <ul className="import-skip-list">
                      {matchSummary.unmatchedRows.slice(0, 10).map((u, i) => (
                        <li key={i}>
                          Row {u.line} (Trip {u.tripId}): {u.raw}
                        </li>
                      ))}
                      {matchSummary.unmatchedRows.length > 10 && (
                        <li>…and {matchSummary.unmatchedRows.length - 10} more</li>
                      )}
                    </ul>
                  </>
                )}
              </>
            )}
            {parsed.skipped.length > 0 && (
              <>
                {' · '}
                <b>{parsed.skipped.length}</b> skipped
                <ul className="import-skip-list">
                  {parsed.skipped.slice(0, 10).map((s) => (
                    <li key={s.line}>
                      Row {s.line}: {s.reason}
                    </li>
                  ))}
                  {parsed.skipped.length > 10 && <li>…and {parsed.skipped.length - 10} more</li>}
                </ul>
              </>
            )}
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-square"
            disabled={busy || !parsed?.ok.length}
            onClick={runImport}
          >
            {busy ? 'Importing…' : `Import ${parsed?.ok.length || 0}`}
          </button>
        </div>
      </div>
    </Modal>
  )
}
