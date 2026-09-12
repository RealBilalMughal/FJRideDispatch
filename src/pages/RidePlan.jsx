import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Ban, ChevronLeft, ChevronRight, Download, MessageSquare, Navigation, RefreshCw, Sigma, Trash2, Upload } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { useCity } from '../context/useCity'
import { fmtDate } from '../lib/format'
import { addDays, fmtTime12, pkToday } from '../lib/time'
import { blockLabel } from '../lib/rideRoute'
import { gmapsRoute } from '../lib/ors'
import { checkHeaders, downloadCsv, parseCsvObjects, toCsv } from '../lib/csv'
import { PLAN_REQUIRED_COLUMNS, buildPlanRows } from '../lib/planImport'
import Modal from '../components/Modal'
import ConfirmDelete from '../components/ConfirmDelete'
import DataTable from '../components/data/DataTable'
import StatCards from '../components/data/StatCards'
import '../components/data/data.css'
import './RidePlan.css'

// Fixed order for the top KM summary - not the insertion order rows happen
// to appear in.
const SUMMARY_BLOCKS = ['deadhead', 'pickup', 'dropoff', 'return_leg']

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

// A followed Pickup/Dropoff whose dispatched ride ended up with a different
// crew count than the plan (e.g. plan had 2, only 1 was actually added).
const hasCrewMismatch = (row) =>
  row.status === 'followed' &&
  (row.block_type === 'pickup' || row.block_type === 'dropoff') &&
  row.actualCrewCount != null &&
  row.actualCrewCount !== (row.crew_matches || []).length

function CrewMatchCell({ row, crew }) {
  const matches = row.crew_matches
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
      {hasCrewMismatch(row) && (
        <div className="status-text bad">
          Actual: {row.actualCrewCount} of {matches.length} planned
        </div>
      )}
    </div>
  )
}

function StatusCell({ row }) {
  if (row.status === 'followed')
    return (
      <span className={`status-text ${row.via_no ? 'bad' : 'on'}`}>
        {row.via_no ? 'No Follow' : 'Followed'}
        {row.ride ? ` · ${row.ride.ref_no}` : ''}
      </span>
    )
  if (row.status === 'skipped')
    return (
      <span className="status-text bad" title={row.skip_reason || ''}>
        No
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
  const canDelete = can('ride_plan', 'delete')

  const [planDate, setPlanDate] = useState(pkToday())
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [importOpen, setImportOpen] = useState(false)
  const [skipFor, setSkipFor] = useState(null)
  const [noReasonFor, setNoReasonFor] = useState(null) // a row - "No" reason prompt before it opens the Add Ride flow
  const [reasonFor, setReasonFor] = useState(null) // a row - view its saved reason (No or Not happening)
  const [reportOpen, setReportOpen] = useState(false)
  const [deletePlanOpen, setDeletePlanOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // The page itself never scrolls - only the table does, in its own fixed-
  // height box, with its header frozen inside that box. topBarH re-triggers
  // the table-height recalc below whenever the fixed area above it changes
  // size (the Report panel opening, text wrapping on a narrow screen, etc.).
  const topBarRef = useRef(null)
  const [topBarH, setTopBarH] = useState(0)
  useEffect(() => {
    const el = topBarRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setTopBarH(entry.contentRect.height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Measure exactly how much viewport height is left below the table's own
  // start (title/summary/date-bar/Report above it, whatever chrome sits
  // above the page) rather than guessing - so the table's box is always
  // sized to make the WHOLE page fit in one viewport with no page scroll.
  const tableWrapRef = useRef(null)
  const [tableMaxH, setTableMaxH] = useState(null)
  // 48px = .app-content's own bottom padding (layout.css) - it sits AFTER
  // .page ends, so it has to come off the table's budget too, or the page
  // is left just tall enough to trigger a few px of page-level scroll.
  const APP_CONTENT_BOTTOM_PAD = 48
  useEffect(() => {
    const el = tableWrapRef.current
    if (!el) return
    const recalc = () => {
      const top = el.getBoundingClientRect().top
      setTableMaxH(Math.max(200, window.innerHeight - top - APP_CONTENT_BOTTOM_PAD))
    }
    recalc()
    window.addEventListener('resize', recalc)
    return () => window.removeEventListener('resize', recalc)
  }, [topBarH, reportOpen])

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
      .select('*, ride:rides(id, ref_no, distance_km, status, count_km, vehicle_id, waypoints)')
      .eq('plan_date', planDate)
      .order('seq')
    if (cityId != null) q = q.eq('city_id', cityId)
    const { data, error } = await q
    if (error) toast.error('Could not load the plan')
    const list = data ?? []

    // The linked ride's REAL crew (names, for their own column) and vehicle
    // (for the planned-vs-actual check below) - fetched client-side rather
    // than relying on a PostgREST count-aggregate embed that may not be
    // available.
    const rideIds = [...new Set(list.filter((r) => r.ride?.id).map((r) => r.ride.id))]
    let crewByRide = new Map()
    if (rideIds.length) {
      const { data: rc } = await supabase
        .from('ride_crew')
        .select('ride_id, seq, crew:crew(name)')
        .in('ride_id', rideIds)
        .order('seq')
      crewByRide = (rc ?? []).reduce((m, x) => {
        const arr = m.get(x.ride_id) || []
        if (x.crew?.name) arr.push(x.crew.name)
        return m.set(x.ride_id, arr)
      }, new Map())
    }
    setRows(
      list.map((r) => {
        const names = r.ride?.id ? crewByRide.get(r.ride.id) || [] : null
        const actualVehicleNo = r.ride?.vehicle_id
          ? vehicles.find((v) => v.id === r.ride.vehicle_id)?.vehicle_no ?? null
          : null
        return { ...r, actualCrewNames: names, actualCrewCount: names?.length ?? null, actualVehicleNo }
      }),
    )
    setLoading(false)
  }, [canView, planDate, cityId, vehicles])

  useEffect(() => {
    fetchRows()
  }, [fetchRows])

  // Deadhead / Return Leg rows aren't dispatched directly - they ride along on
  // the ALREADY-BUILT "Also create a Deadhead" (Pickup) / "Also create a
  // Return Leg" (Dropoff) features. Once this row's own sibling is followed,
  // check whether its companion ride now exists and auto-link it. Paired by
  // adjacent `seq`, NOT Trip ID - a Deadhead is the row immediately BEFORE
  // its Pickup, a Return Leg immediately AFTER its Dropoff (confirmed
  // against real data; Trip ID only happens to match for the Deadhead case).
  const siblingBlock = { deadhead: 'pickup', return_leg: 'dropoff' }
  const siblingSeq = (r) => (r.block_type === 'deadhead' ? r.seq + 1 : r.block_type === 'return_leg' ? r.seq - 1 : null)
  const reconciling = useRef(false)
  useEffect(() => {
    if (!canEdit) return
    const pending = rows.filter((r) => r.status === 'pending' && siblingBlock[r.block_type])
    if (!pending.length || reconciling.current) return
    reconciling.current = true
    ;(async () => {
      let changed = false
      for (const r of pending) {
        const sibling = rows.find(
          (s) => s.seq === siblingSeq(r) && s.block_type === siblingBlock[r.block_type] && s.status === 'followed',
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

  const canFollow = (r) => r.status === 'pending'

  // "No" asks for a reason FIRST, saves it, then opens the same Add Ride
  // flow as Follow - the reason is just context for why this deviated from
  // plan, not a block on actually dispatching it.
  const doNoReason = async (reason) => {
    if (!noReasonFor) return
    const trimmed = reason.trim()
    if (trimmed) {
      const { error } = await supabase
        .from('ride_plan_rows')
        .update({ skip_reason: trimmed })
        .eq('id', noReasonFor.id)
      if (error) return toast.error(error.message)
    }
    const id = noReasonFor.id
    setNoReasonFor(null)
    navigate(`/rides?planRow=${id}&plan_no=1`)
  }

  // A "Skip" can instead LINK an already-created ride (e.g. one dispatched
  // manually on the Rides page, outside the Follow flow) by its ref number -
  // the row then counts as followed and its Actual KM feeds the report,
  // same as a row that went through Follow.
  const doSkip = async (reason, refNo) => {
    if (!skipFor) return
    if (refNo) {
      const { data: linkedRide, error: findErr } = await supabase
        .from('rides')
        .select('id')
        .eq('ref_no', Number(refNo))
        .maybeSingle()
      if (findErr) return toast.error(findErr.message)
      if (!linkedRide) return toast.error(`Ride ${refNo} not found`)
      const { error } = await supabase
        .from('ride_plan_rows')
        .update({
          status: 'followed',
          ride_id: linkedRide.id,
          skip_reason: reason.trim() || null,
          via_no: true,
        })
        .eq('id', skipFor.id)
      if (error) return toast.error(error.message)
      toast.success(`Linked to ride ${refNo}`)
      setSkipFor(null)
      return fetchRows()
    }
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
      .update({ status: 'pending', skip_reason: null, ride_id: null, via_no: false })
      .eq('id', row.id)
    if (error) return toast.error(error.message)
    fetchRows()
  }

  // Deletes this day's plan rows only (not the rides they were followed
  // into) - a plan can be re-uploaded after a correction without touching
  // whatever has already been dispatched.
  const doDeletePlan = async () => {
    setDeleting(true)
    let q = supabase.from('ride_plan_rows').delete().eq('plan_date', planDate)
    if (cityId != null) q = q.eq('city_id', cityId)
    const { error } = await q
    setDeleting(false)
    if (error) return toast.error(error.message)
    toast.success(`Deleted the plan for ${fmtDate(planDate)}`)
    setDeletePlanOpen(false)
    fetchRows()
  }

  const report = useMemo(() => {
    const byBlock = {}
    for (const r of rows) {
      const b = (byBlock[r.block_type] ??= {
        block: r.block_type,
        followed: 0,
        plannedKm: 0,
        actualKm: 0,
        crewMismatch: 0,
      })
      if (r.status !== 'followed') continue
      b.followed += 1
      b.plannedKm += Number(r.planned_km) || 0
      b.actualKm += Number(billableKm(r.ride)) || 0
      if (hasCrewMismatch(r)) b.crewMismatch += 1
    }
    return Object.values(byBlock)
  }, [rows])

  // Top summary: the WHOLE day's planned KM per block type (every row, not
  // just followed ones - this is the plan itself), alongside how much of it
  // has actually happened so far (followed rows only).
  const summary = useMemo(() => {
    const byBlock = Object.fromEntries(SUMMARY_BLOCKS.map((b) => [b, { plannedKm: 0, actualKm: 0, followed: 0 }]))
    for (const r of rows) {
      const b = byBlock[r.block_type]
      if (!b) continue
      b.plannedKm += Number(r.planned_km) || 0
      if (r.status === 'followed') {
        b.followed += 1
        b.actualKm += Number(billableKm(r.ride)) || 0
      }
    }
    byBlock.total = Object.values(byBlock).reduce(
      (t, b) => ({ plannedKm: t.plannedKm + b.plannedKm, actualKm: t.actualKm + b.actualKm, followed: t.followed + b.followed }),
      { plannedKm: 0, actualKm: 0, followed: 0 },
    )
    return byBlock
  }, [rows])

  const statusCounts = useMemo(
    () => ({
      followed: rows.filter((r) => r.status === 'followed').length,
      no: rows.filter((r) => r.status === 'skipped').length,
      pending: rows.filter((r) => r.status === 'pending').length,
    }),
    [rows],
  )
  const totalDelta = summary.total.actualKm - summary.total.plannedKm

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
    { key: 'crew', header: 'Crew', render: (r) => <CrewMatchCell row={r} crew={crew} /> },
    {
      key: 'crewCount',
      header: 'Crew Count',
      align: 'right',
      render: (r) => r.crew_count ?? r.crew_matches?.length ?? '—',
    },
    {
      key: 'actualCrew',
      header: 'Actual Crew',
      render: (r) =>
        r.status === 'followed' && r.actualCrewNames ? (
          r.actualCrewNames.length ? (
            <div className="crew-cell-stack">
              {r.actualCrewNames.map((n, i) => (
                <div key={i}>{n}</div>
              ))}
            </div>
          ) : (
            <span className="secondary">—</span>
          )
        ) : (
          '—'
        ),
    },
    {
      key: 'car',
      header: 'Vehicle',
      render: (r) => (
        <>
          <div>
            {r.car || '—'}
            {r.is_adhoc_car && <span className="status-text off"> · ad-hoc</span>}
            {!r.is_adhoc_car && r.car && !r.matched_vehicle_id && <span className="status-text bad"> · not in fleet</span>}
          </div>
          {r.status === 'followed' && r.actualVehicleNo && r.actualVehicleNo !== r.car && (
            <div className="status-text bad">Actual: {r.actualVehicleNo}</div>
          )}
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
      key: 'delta',
      header: 'Difference',
      align: 'right',
      render: (r) => {
        if (r.status !== 'followed' || !r.ride) return '—'
        const d = (Number(billableKm(r.ride)) || 0) - (Number(r.planned_km) || 0)
        return <span className={`status-text ${d > 0 ? 'bad' : 'on'}`}>{d.toFixed(2)}</span>
      },
    },
    {
      key: 'actions',
      header: 'Action',
      render: (r) => {
        const gm = r.status === 'followed' ? gmapsRoute(r.ride?.waypoints) : null
        return (
          <div className="rp-row-actions">
            {canEdit && canFollow(r) && (
              <button
                type="button"
                className="btn btn-ghost btn-square btn-sm rp-follow-btn"
                onClick={() => navigate(`/rides?planRow=${r.id}`)}
              >
                Follow
              </button>
            )}
            {canEdit && canFollow(r) && (
              <button
                type="button"
                className="btn btn-ghost btn-square btn-sm rp-no-btn"
                onClick={() => setNoReasonFor(r)}
              >
                No
              </button>
            )}
            {canEdit && r.status === 'pending' && (
              <button
                type="button"
                className="icon-btn"
                title="Not happening"
                onClick={() => setSkipFor(r)}
              >
                <Ban size={15} />
              </button>
            )}
            {canEdit && r.status === 'skipped' && (
              <button type="button" className="btn btn-ghost btn-square btn-sm" onClick={() => reopen(r)}>
                Reopen
              </button>
            )}
            {r.skip_reason && (
              <button
                type="button"
                className="icon-btn rp-reason-btn"
                title="View reason"
                onClick={() => setReasonFor(r)}
              >
                <MessageSquare size={15} />
              </button>
            )}
            {gm && (
              <a href={gm} target="_blank" rel="noreferrer" className="icon-btn" title="Open ride route in Google Maps">
                <Navigation size={15} />
              </a>
            )}
          </div>
        )
      },
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
      <div ref={topBarRef} className="rp-frozen-top">
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
            {canDelete && rows.length > 0 && (
              <button className="btn btn-square btn-sm btn-danger" onClick={() => setDeletePlanOpen(true)}>
                <Trash2 size={14} /> Delete plan
              </button>
            )}
          </div>
        </div>

        <StatCards
          items={[
            {
              key: 'total',
              label: 'Total',
              value: `${summary.total.plannedKm.toFixed(2)} km`,
              hint: `Actual: ${summary.total.actualKm.toFixed(2)} km${summary.total.followed ? ` (${summary.total.followed} followed)` : ''}`,
              active: true,
            },
            {
              key: 'difference',
              label: 'Difference',
              value: (
                <span style={{ color: totalDelta > 0 ? 'var(--danger)' : 'var(--success)' }}>
                  {totalDelta >= 0 ? '+' : ''}
                  {totalDelta.toFixed(2)} km
                </span>
              ),
              hint: totalDelta > 0 ? 'over plan' : totalDelta < 0 ? 'under plan' : 'on plan',
            },
            ...SUMMARY_BLOCKS.map((b) => ({
              key: b,
              label: blockLabel(b),
              value: `${summary[b].plannedKm.toFixed(2)} km`,
              hint: `Actual: ${summary[b].actualKm.toFixed(2)} km${summary[b].followed ? ` (${summary[b].followed} followed)` : ''}`,
            })),
            {
              key: 'followed-count',
              label: 'Followed',
              value: statusCounts.followed,
              hint: `${statusCounts.pending} pending`,
            },
            {
              key: 'no-count',
              label: 'No',
              value: statusCounts.no,
              hint: `${statusCounts.pending} pending`,
            },
          ]}
        />

        <div className="rp-datebar">
          <button type="button" className="icon-btn" onClick={() => setPlanDate((d) => addDays(d, -1))}>
            <ChevronLeft size={16} />
          </button>
          <input
            type="date"
            className="input"
            value={planDate}
            onChange={(e) => setPlanDate(e.target.value)}
          />
          <button type="button" className="icon-btn" onClick={() => setPlanDate((d) => addDays(d, 1))}>
            <ChevronRight size={16} />
          </button>
          {planDate !== pkToday() && (
            <button type="button" className="btn btn-ghost btn-square btn-sm" onClick={() => setPlanDate(pkToday())}>
              Today
            </button>
          )}
        </div>
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
                  <th>Crew mismatch</th>
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
                    <td className={b.crewMismatch > 0 ? 'status-text bad' : 'status-text off'}>{b.crewMismatch}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div
        ref={tableWrapRef}
        className="rp-plan-table"
        style={tableMaxH ? { '--rp-table-max-h': `${tableMaxH}px` } : undefined}
      >
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          loading={loading}
          emptyLabel="No plan uploaded for this date"
        />
      </div>

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
            if (earliestDate && earliestDate !== planDate) setPlanDate(earliestDate)
            else fetchRows()
          }}
        />
      )}

      {skipFor && <SkipModal row={skipFor} onClose={() => setSkipFor(null)} onSkip={doSkip} />}
      {noReasonFor && (
        <NoReasonModal row={noReasonFor} onClose={() => setNoReasonFor(null)} onContinue={doNoReason} />
      )}
      {reasonFor && <ReasonPopup row={reasonFor} onClose={() => setReasonFor(null)} />}

      <ConfirmDelete
        open={deletePlanOpen}
        title={`Delete the plan for ${fmtDate(planDate)}`}
        message={`This permanently deletes ${rows.length} plan row(s) for ${fmtDate(planDate)}${cityName !== 'All cities' ? ` · ${cityName}` : ''}. Rides already dispatched from them are NOT affected.`}
        busy={deleting}
        onConfirm={doDeletePlan}
        onClose={() => setDeletePlanOpen(false)}
      />
    </div>
  )
}

function NoReasonModal({ row, onClose, onContinue }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal open onClose={onClose} title={`Trip ${row.trip_id} - Reason for No`} width={420}>
      <div className="modal-form">
        <div className="field">
          <label htmlFor="no-reason">Reason (optional)</label>
          <textarea
            id="no-reason"
            className="input"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. flight delayed, vehicle swapped…"
            autoFocus
          />
        </div>
        <span className="field-hint">
          Saved on this row (click its <MessageSquare size={11} /> icon later to see it), then opens the
          Add Ride form to dispatch it.
        </span>
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
              await onContinue(reason)
              setBusy(false)
            }}
          >
            {busy ? 'Working…' : 'Continue'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function ReasonPopup({ row, onClose }) {
  return (
    <Modal open onClose={onClose} title={`Trip ${row.trip_id} - Reason`} width={380}>
      <div className="modal-form">
        <p className="confirm-msg">{row.skip_reason}</p>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  )
}

function SkipModal({ row, onClose, onSkip }) {
  const [reason, setReason] = useState('')
  const [refNo, setRefNo] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal open onClose={onClose} title={`Trip ${row.trip_id} - Not Happening`} width={420}>
      <div className="modal-form">
        <div className="field">
          <label htmlFor="skip-refno">Ride ID (optional)</label>
          <input
            id="skip-refno"
            className="input"
            inputMode="numeric"
            value={refNo}
            onChange={(e) => setRefNo(e.target.value.replace(/\D/g, ''))}
            placeholder="e.g. 1234 - if this trip was already dispatched separately"
          />
          <span className="field-hint">
            Link an already-created ride's ID instead - the row counts as followed and its Actual KM
            feeds the report.
          </span>
        </div>
        <div className="field">
          <label htmlFor="skip-reason">Note (optional)</label>
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
              await onSkip(reason, refNo)
              setBusy(false)
            }}
          >
            {busy ? 'Working…' : refNo ? 'Link ride' : 'Confirm'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function ImportModal({ allowedCities, flights, crew, vehicles, cityId, createdBy, onClose, onDone }) {
  const [parsed, setParsed] = useState(null) // { ok, skipped, warning }
  const [existing, setExisting] = useState(null) // { total, followed, dates } for dates this file also covers, or null
  const [replaceConfirmed, setReplaceConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const downloadSample = () => downloadCsv('ride-plan-sample.csv', toCsv(SAMPLE_COLS, SAMPLE))

  const onFile = async (e) => {
    setErr('')
    setParsed(null)
    setExisting(null)
    setReplaceConfirmed(false)
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const { headers, records } = parseCsvObjects(text)
    const hc = checkHeaders(headers, PLAN_REQUIRED_COLUMNS, PLAN_REQUIRED_COLUMNS)
    if (!hc.ok) return setErr(hc.error)
    const { ok, skipped } = buildPlanRows(records, { allowedCities, flights, crew, vehicles })
    setParsed({ ok, skipped, warning: hc.warning })

    // Re-uploading a file that covers dates already imported would otherwise
    // just ADD a second copy of every row (seq collides with the earlier
    // import's own 2.. numbering too, breaking the sheet-order display) -
    // check for that up front so the dispatcher can choose to replace.
    const dates = [...new Set(ok.map((r) => r.plan_date))]
    const cityIds = [...new Set(ok.map((r) => r.city_id))]
    if (dates.length && cityIds.length) {
      const { data: ex } = await supabase
        .from('ride_plan_rows')
        .select('plan_date, status')
        .in('plan_date', dates)
        .in('city_id', cityIds)
      if (ex?.length) {
        setExisting({
          total: ex.length,
          followed: ex.filter((r) => r.status === 'followed').length,
          dates,
          cityIds,
        })
      }
    }
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
    if (existing && !replaceConfirmed) return
    setBusy(true)
    // the import batch's own city - the currently filtered city, else the most
    // common Base among the parsed rows (a plan can span more than one city)
    const counts = new Map()
    parsed.ok.forEach((r) => counts.set(r.city_id, (counts.get(r.city_id) || 0) + 1))
    const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    const importCityId = cityId ?? dominant

    if (existing) {
      const { error: delErr } = await supabase
        .from('ride_plan_rows')
        .delete()
        .in('plan_date', existing.dates)
        .in('city_id', existing.cityIds)
      if (delErr) {
        setBusy(false)
        return setErr(delErr.message)
      }
    }

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
      .insert(parsed.ok.map(({ line, ...r }) => ({ ...r, seq: line, import_id: imp.id })))
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

        {existing && (
          <div className="import-summary">
            <div className="modal-error">
              <b>{existing.total}</b> row(s) already exist for {existing.dates.length} date(s) this file
              covers{existing.followed ? ` — ${existing.followed} already Followed/No` : ''}. Importing will{' '}
              <b>replace</b> them (delete, then re-import), or Cancel and pick a different date range.
            </div>
            <label className="check-line" style={{ marginTop: 6 }}>
              <input
                type="checkbox"
                checked={replaceConfirmed}
                onChange={(e) => setReplaceConfirmed(e.target.checked)}
              />
              Yes, delete the {existing.total} existing row(s) and replace them
            </label>
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-square"
            disabled={busy || !parsed?.ok.length || (existing && !replaceConfirmed)}
            onClick={runImport}
          >
            {busy ? 'Importing…' : `Import ${parsed?.ok.length || 0}`}
          </button>
        </div>
      </div>
    </Modal>
  )
}
