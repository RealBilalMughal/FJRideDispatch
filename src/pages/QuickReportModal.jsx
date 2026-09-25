import { useEffect, useRef, useState } from 'react'
import { GripVertical, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import Modal from '../components/Modal'
import SearchSelect from '../components/SearchSelect'
import RouteMap from '../components/RouteMap'
import { blockExtraKm, buildRoutePoints, routeComplete } from '../lib/rideRoute'
import { routeInfo } from '../lib/ors'

const NO_REASON_OPTIONS = [
  'CP/FO Not Sharing Car',
  'Crew Change',
  'Foreigner FO',
  'Route Change',
  '2 Pickup / 3',
  'Ride Time Mismatched',
  'Flight Change',
  'Combine with other',
  'Double Sector',
  'Single Pickup / Combine',
  'Flight Delay',
  'Off Load',
  'Completed with Off load',
  'Extra Pickup',
]

function initCrew({ row, crew, singleCrewId, editMode }) {
  if (editMode && row.actual_crew_names) {
    // Re-populate from saved names — match against crew list by name
    return row.actual_crew_names
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean)
      .map((name) => crew.find((c) => c.name === name) ?? { id: `name_${name}`, name })
      .filter(Boolean)
  }
  const matches = (row.crew_matches ?? []).filter((m) => m.crew_id)
  if (singleCrewId) {
    const m = matches.find((m) => m.crew_id === singleCrewId)
    if (m) {
      const found = crew.find((c) => c.id === m.crew_id)
      return found ? [found] : [{ id: m.crew_id, name: m.name }]
    }
    return []
  }
  return matches
    .map((m) => crew.find((c) => c.id === m.crew_id) ?? { id: m.crew_id, name: m.name })
    .filter(Boolean)
}

function initVehicleState({ row, vehicles, editMode }) {
  if (!editMode || !row.actual_vehicle_no) return { mode: 'same', type: 'fleet', fleetId: '', adhoc: '' }
  const saved = row.actual_vehicle_no
  if (saved === (row.car || null)) return { mode: 'same', type: 'fleet', fleetId: '', adhoc: '' }
  const fleet = vehicles.find((v) => v.vehicle_no === saved)
  if (fleet) return { mode: 'different', type: 'fleet', fleetId: fleet.id, adhoc: '' }
  return { mode: 'different', type: 'adhoc', fleetId: '', adhoc: saved }
}

export default function QuickReportModal({
  row, pairedRow, crew, vehicles, cityId, city, rows,
  singleCrewId = null, editMode = false, isNew = false,
  defaultBufferEnabled = true,
  onDone, onClose,
}) {
  const { profile } = useAuth()

  const [actualCrew, setActualCrew] = useState(() =>
    initCrew({ row, crew, singleCrewId, editMode }),
  )

  const initV = initVehicleState({ row, vehicles, editMode })
  const [vehicleMode, setVehicleMode] = useState(initV.mode)
  const [vehicleType, setVehicleType] = useState(initV.type)
  const [fleetVehicleId, setFleetVehicleId] = useState(initV.fleetId)
  const [adhocNo, setAdhocNo] = useState(initV.adhoc)

  const [alsoCreatePaired, setAlsoCreatePaired] = useState(false)
  const [bufferEnabled, setBufferEnabled] = useState(defaultBufferEnabled)
  const [reasons, setReasons] = useState(() =>
    editMode && row.report_reason
      ? row.report_reason.split(', ').filter(Boolean)[0] || ''
      : '',
  )
  const [remarks, setRemarks] = useState(editMode ? (row.report_remarks || '') : '')
  const [routeData, setRouteData] = useState(null)
  const [routeLoading, setRouteLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const routeAlive = useRef(true)
  const dragIdx = useRef(null)

  // Auto-assign Ad-Hoc number (only for new adhoc, not edit)
  useEffect(() => {
    if (vehicleMode !== 'different' || vehicleType !== 'adhoc' || adhocNo) return
    let alive = true
    supabase
      .from('rides')
      .select('adhoc_vehicle_no')
      .eq('city_id', row.city_id ?? cityId)
      .eq('ride_date', row.plan_date)
      .eq('is_adhoc_vehicle', true)
      .then(({ data }) => {
        if (!alive) return
        const nums = (data ?? [])
          .map((r) => Number(String(r.adhoc_vehicle_no ?? '').match(/(\d+)\s*$/)?.[1]))
          .filter(Number.isFinite)
        const next = nums.length ? Math.max(...nums) + 1 : 1
        setAdhocNo(`Ad-Hoc ${String(next).padStart(2, '0')}`)
      })
    return () => { alive = false }
  }, [vehicleMode, vehicleType, adhocNo, cityId, row.plan_date])

  // Recompute route whenever actualCrew changes
  useEffect(() => {
    const airport = city
      ? { name: city.airport_name, lat: city.airport_lat, lng: city.airport_lng }
      : {}
    const pts = buildRoutePoints(row.block_type, null, actualCrew, airport)
    if (!routeComplete(pts)) { setRouteData(null); return }

    let alive = true
    setRouteLoading(true)
    routeInfo(pts.map((p) => [p.lng, p.lat])).then((info) => {
      if (!alive) return
      setRouteData(info ?? null)
      setRouteLoading(false)
    }).catch(() => { if (alive) setRouteLoading(false) })
    return () => { alive = false }
  }, [actualCrew, row.block_type, city])

  const setVehicleModeSafe = (m) => {
    setVehicleMode(m)
    if (m === 'same') { setFleetVehicleId(''); setAdhocNo('') }
  }
  const setVehicleTypeSafe = (t) => {
    setVehicleType(t)
    if (t === 'fleet') setAdhocNo('')
    if (t === 'adhoc') setFleetVehicleId('')
  }

  const removeCrew = (id) => setActualCrew((c) => c.filter((x) => x.id !== id))
  const addCrewById = (id) => {
    const c = crew.find((x) => x.id === id)
    if (c && !actualCrew.find((x) => x.id === id)) setActualCrew((a) => [...a, c])
  }

  const crewOptions = crew
    .filter((c) => !actualCrew.find((x) => x.id === c.id))
    .map((c) => ({ value: c.id, label: `(${c.ref_no}) ${c.name}` }))

  const effectiveCityId = row.city_id ?? cityId
  const vehicleOptions = vehicles
    .filter((v) => !effectiveCityId || v.city_id === effectiveCityId)
    .map((v) => ({ value: v.id, label: v.vehicle_no }))

  const resolvedVehicleNo = () => {
    if (vehicleMode === 'same') return row.car || null
    if (vehicleType === 'fleet') return vehicles.find((v) => v.id === fleetVehicleId)?.vehicle_no || null
    return adhocNo || null
  }

  const airport = city
    ? { name: city.airport_name, lat: city.airport_lat, lng: city.airport_lng }
    : {}
  const routePts = buildRoutePoints(row.block_type, null, actualCrew, airport)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!reasons) {
      toast.error('Select a reason')
      return
    }
    setBusy(true)

    const crewNames = actualCrew.map((c) => c.name).join(', ') || null
    const vehicleNo = resolvedVehicleNo()
    const now = new Date().toISOString()
    const reporter = (profile?.full_name || '').trim() || profile?.email || ''
    const extraKm = bufferEnabled ? blockExtraKm(row.block_type, city) : 0
    const kmVal = routeData?.distanceKm != null
      ? parseFloat((routeData.distanceKm + extraKm).toFixed(2))
      : null

    const base = {
      status: 'followed',
      via_no: true,
      actual_crew_names: crewNames,
      actual_vehicle_no: vehicleNo,
      actual_km: kmVal,
      report_reason: reasons,
      report_remarks: remarks.trim() || null,
      reported_by_name: reporter || null,
      reported_at: now,
    }

    // ── isNew: INSERT new row(s) right below the original pickup/deadhead group ──
    if (isNew) {
      const crewMatches = actualCrew.map((c) => ({ crew_id: c.id, name: c.name }))
      const withPaired = Boolean(pairedRow && alsoCreatePaired)
      const insertCount = withPaired ? 2 : 1

      // Anchor = last seq in the original group we insert after:
      // pickup: insert after the pickup itself (deadhead at row.seq-1, pickup at row.seq)
      // dropoff + paired return_leg: insert after the return_leg (pairedRow.seq)
      // dropoff without paired: insert after the dropoff (row.seq)
      const anchorSeq = (row.block_type === 'dropoff' && withPaired && pairedRow)
        ? pairedRow.seq
        : row.seq

      // Shift all rows after anchor to make room
      const effectiveCityId2 = row.city_id ?? cityId
      const { data: shiftRows, error: shiftFetchErr } = await supabase
        .from('ride_plan_rows')
        .select('id, seq')
        .eq('plan_date', row.plan_date)
        .eq('city_id', effectiveCityId2)
        .gt('seq', anchorSeq)
      if (shiftFetchErr) { toast.error('Seq shift failed: ' + shiftFetchErr.message); setBusy(false); return }
      if (shiftRows?.length) {
        const results = await Promise.all(
          shiftRows.map((sr) =>
            supabase.from('ride_plan_rows').update({ seq: sr.seq + insertCount }).eq('id', sr.id),
          ),
        )
        const shiftErr = results.find((r) => r.error)?.error
        if (shiftErr) { toast.error('Seq shift failed: ' + shiftErr.message); setBusy(false); return }
      }

      const newMain = {
        import_id: row.import_id,
        plan_date: row.plan_date,
        city_id: row.city_id,
        trip_id: row.trip_id,
        block_type: row.block_type,
        flight_no: row.flight_no,
        matched_flight_id: row.matched_flight_id,
        origin: row.origin,
        destination: row.destination,
        start_time: row.start_time,
        end_time: row.end_time,
        planned_km: null,
        crew_raw: crewNames,
        crew_matches: crewMatches,
        crew_count: actualCrew.length,
        car: vehicleNo,
        matched_vehicle_id: null,
        is_adhoc_car: vehicleType === 'adhoc',
        ...base,
      }

      const toInsert = []
      if (withPaired) {
        const newPaired = {
          import_id: pairedRow.import_id,
          plan_date: pairedRow.plan_date,
          city_id: pairedRow.city_id,
          trip_id: pairedRow.trip_id,
          block_type: pairedRow.block_type,
          flight_no: pairedRow.flight_no,
          matched_flight_id: pairedRow.matched_flight_id,
          origin: pairedRow.origin,
          destination: pairedRow.destination,
          start_time: pairedRow.start_time,
          end_time: pairedRow.end_time,
          planned_km: null,
          crew_raw: crewNames,
          crew_matches: crewMatches,
          crew_count: actualCrew.length,
          car: vehicleNo,
          matched_vehicle_id: null,
          is_adhoc_car: vehicleType === 'adhoc',
          ...base,
        }
        if (row.block_type === 'pickup') {
          // deadhead first (anchorSeq+1), pickup after (anchorSeq+2)
          toInsert.push({ ...newPaired, seq: anchorSeq + 1 })
          toInsert.push({ ...newMain, seq: anchorSeq + 2 })
        } else {
          // dropoff first (anchorSeq+1), return_leg after (anchorSeq+2)
          toInsert.push({ ...newMain, seq: anchorSeq + 1 })
          toInsert.push({ ...newPaired, seq: anchorSeq + 2 })
        }
      } else {
        toInsert.push({ ...newMain, seq: anchorSeq + 1 })
      }

      const { error } = await supabase.from('ride_plan_rows').insert(toInsert)
      if (error) { toast.error('Insert failed: ' + error.message); setBusy(false); return }
      toast.success('Ride dispatched')
      setBusy(false)
      onDone()
      return
    }

    // ── editMode: UPDATE existing row ──
    const { error: e1 } = await supabase
      .from('ride_plan_rows')
      .update(base)
      .eq('id', row.id)

    if (e1) { toast.error('Save failed: ' + e1.message); setBusy(false); return }

    // Update paired row silently with same data
    if (pairedRow) {
      await supabase.from('ride_plan_rows').update({ ...base }).eq('id', pairedRow.id)
    }

    toast.success(editMode ? 'Report updated' : 'Report saved')

    setBusy(false)
    onDone()
  }

  const blockLabel = row.block_type?.replace('_', ' ') || '—'
  const modalTitle = isNew
    ? `Dispatch · ${blockLabel} · ${row.flight_no || '—'}`
    : editMode
    ? `Edit Report · ${blockLabel} · ${row.flight_no || '—'}`
    : `Report · ${blockLabel} · ${row.flight_no || '—'}`

  return (
    <Modal
      open
      width={520}
      title={modalTitle}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="qrm-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : editMode ? 'Update Report' : 'Save Report'}
          </button>
        </>
      }
    >
      <form id="qrm-form" className="modal-form" onSubmit={handleSubmit}>
        <div>
          <p className="qrm-subtitle">
            {row.plan_date} &nbsp;·&nbsp; {row.origin} → {row.destination}
            {routeLoading && <span className="secondary" style={{ fontSize: 11 }}> Calculating…</span>}
            {!routeLoading && routeData?.distanceKm != null && (() => {
              const extra = bufferEnabled ? blockExtraKm(row.block_type, city) : 0
              const total = routeData.distanceKm + extra
              return (
                <span className="qrm-km-badge">
                  {extra > 0
                    ? `${routeData.distanceKm.toFixed(2)} + ${extra.toFixed(2)} = ${total.toFixed(2)} km`
                    : `${total.toFixed(2)} km`}
                </span>
              )
            })()}
            {['pickup', 'dropoff'].includes(row.block_type) && (
              <label className="qrm-radio" style={{ marginLeft: 4 }}>
                <input
                  type="checkbox"
                  checked={bufferEnabled}
                  onChange={(e) => setBufferEnabled(e.target.checked)}
                />
                Buffer KM
              </label>
            )}
          </p>

          {/* ── Crew ── */}
          <div className="field">
            <label>Crew</label>
            <div className="qrm-crew-list">
              {actualCrew.map((c, i) => (
                <span
                  key={c.id}
                  className="qrm-crew-tag"
                  draggable
                  onDragStart={() => { dragIdx.current = i }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    if (i === dragIdx.current) return
                    e.currentTarget.style.boxShadow = 'inset 0 2px 0 0 var(--accent)'
                  }}
                  onDragLeave={(e) => { e.currentTarget.style.boxShadow = '' }}
                  onDrop={(e) => {
                    e.currentTarget.style.boxShadow = ''
                    const from = dragIdx.current
                    if (from == null || from === i) return
                    setActualCrew((prev) => {
                      const next = [...prev]
                      const [moved] = next.splice(from, 1)
                      next.splice(i, 0, moved)
                      return next
                    })
                    dragIdx.current = null
                  }}
                  onDragEnd={() => { dragIdx.current = null }}
                >
                  <GripVertical size={11} style={{ opacity: 0.4, flexShrink: 0, cursor: 'grab' }} />
                  {c.name}
                  <button type="button" className="qrm-crew-remove" onClick={() => removeCrew(c.id)}>
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
            <SearchSelect
              value=""
              onChange={addCrewById}
              options={crewOptions}
              placeholder="Add crew…"
            />
          </div>

          {/* ── Also create Return Leg / Deadhead (isNew only) ── */}
          {isNew && pairedRow && (
            <div className="field">
              <label className="qrm-radio" style={{ fontWeight: 500 }}>
                <input
                  type="checkbox"
                  checked={alsoCreatePaired}
                  onChange={(e) => setAlsoCreatePaired(e.target.checked)}
                />
                {row.block_type === 'pickup' ? 'Also create Deadhead' : 'Also create Return Leg'}
              </label>
            </div>
          )}

          {/* ── Actual Vehicle ── */}
          <div className="field">
            <label>Actual vehicle</label>
            <div className="qrm-radio-row">
              <label className="qrm-radio">
                <input
                  type="radio"
                  name="vmode"
                  checked={vehicleMode === 'same'}
                  onChange={() => setVehicleModeSafe('same')}
                />
                Yes — same{row.car ? ` (${row.car})` : ''}
              </label>
              <label className="qrm-radio">
                <input
                  type="radio"
                  name="vmode"
                  checked={vehicleMode === 'different'}
                  onChange={() => setVehicleModeSafe('different')}
                />
                No — different
              </label>
            </div>

            {vehicleMode === 'different' && (
              <div className="qrm-vehicle-sub">
                <div className="qrm-radio-row">
                  <label className="qrm-radio">
                    <input
                      type="radio"
                      name="vtype"
                      checked={vehicleType === 'fleet'}
                      onChange={() => setVehicleTypeSafe('fleet')}
                    />
                    Fleet vehicle
                  </label>
                  <label className="qrm-radio">
                    <input
                      type="radio"
                      name="vtype"
                      checked={vehicleType === 'adhoc'}
                      onChange={() => setVehicleTypeSafe('adhoc')}
                    />
                    Ad-Hoc
                  </label>
                </div>
                {vehicleType === 'fleet' && (
                  <SearchSelect
                    value={fleetVehicleId}
                    onChange={setFleetVehicleId}
                    options={[{ value: '', label: 'Select vehicle…' }, ...vehicleOptions]}
                    placeholder="Search vehicle…"
                  />
                )}
                {vehicleType === 'adhoc' && adhocNo && (
                  <span className="qrm-adhoc-tag">{adhocNo}</span>
                )}
                {vehicleType === 'adhoc' && !adhocNo && (
                  <span className="secondary" style={{ fontSize: 12 }}>Assigning…</span>
                )}
              </div>
            )}
          </div>

          {/* ── Reason ── */}
          <div className="field">
            <label>
              Reason <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <select className="input" value={reasons} onChange={(e) => setReasons(e.target.value)}>
              <option value="">— Select reason —</option>
              {NO_REASON_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>

          {/* ── Remarks ── */}
          <div className="field">
            <label>Remarks <span className="field-hint">(optional)</span></label>
            <textarea
              className="textarea"
              rows={2}
              placeholder="Additional notes…"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </div>
        </div>

        <RouteMap
          points={routePts}
          line={routeData?.line ?? null}
          totalKm={routeData?.distanceKm ?? null}
          height="260px"
        />
      </form>
    </Modal>
  )
}
