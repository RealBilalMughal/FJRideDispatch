import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import Modal from '../components/Modal'
import SearchSelect from '../components/SearchSelect'
import RouteMap from '../components/RouteMap'
import { buildRoutePoints, routeComplete } from '../lib/rideRoute'
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

  const [reasons, setReasons] = useState(() =>
    editMode && row.report_reason
      ? row.report_reason.split(', ').filter(Boolean)
      : [],
  )
  const [remarks, setRemarks] = useState(editMode ? (row.report_remarks || '') : '')
  const [routeData, setRouteData] = useState(null)
  const [routeLoading, setRouteLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const routeAlive = useRef(true)

  // Auto-assign Ad-Hoc number (only for new adhoc, not edit)
  useEffect(() => {
    if (vehicleMode !== 'different' || vehicleType !== 'adhoc' || adhocNo) return
    let alive = true
    supabase
      .from('rides')
      .select('adhoc_vehicle_no')
      .eq('city_id', cityId)
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

  const toggleReason = (opt) =>
    setReasons((prev) => prev.includes(opt) ? prev.filter((x) => x !== opt) : [...prev, opt])

  const removeCrew = (id) => setActualCrew((c) => c.filter((x) => x.id !== id))
  const addCrewById = (id) => {
    const c = crew.find((x) => x.id === id)
    if (c && !actualCrew.find((x) => x.id === id)) setActualCrew((a) => [...a, c])
  }

  const crewOptions = crew
    .filter((c) => !actualCrew.find((x) => x.id === c.id))
    .map((c) => ({ value: c.id, label: `(${c.ref_no}) ${c.name}` }))

  const vehicleOptions = vehicles
    .filter((v) => v.city_id === cityId)
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
    if (reasons.length === 0) {
      toast.error('Select at least one reason')
      return
    }
    setBusy(true)

    const crewNames = actualCrew.map((c) => c.name).join(', ') || null
    const vehicleNo = resolvedVehicleNo()
    const now = new Date().toISOString()
    const reporter = (profile?.full_name || '').trim() || profile?.email || ''
    const kmVal = routeData?.distanceKm != null
      ? parseFloat(routeData.distanceKm.toFixed(2))
      : null

    const base = {
      status: 'followed',
      via_no: true,
      actual_crew_names: crewNames,
      actual_vehicle_no: vehicleNo,
      actual_km: kmVal,
      report_reason: reasons.join(', '),
      report_remarks: remarks.trim() || null,
      reported_by_name: reporter || null,
      reported_at: now,
    }

    // ── isNew: INSERT a new ride_plan_rows record (single crew dispatch) ──
    if (isNew) {
      const maxSeq = Math.max(
        ...((rows ?? []).filter((r) => !r.isExtra).map((r) => r.seq || 0)),
        0,
      )
      const newRow = {
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
        crew_matches: actualCrew.map((c) => ({ crew_id: c.id, name: c.name })),
        crew_count: actualCrew.length,
        car: vehicleNo,
        matched_vehicle_id: null,
        is_adhoc_car: vehicleType === 'adhoc',
        ...base,
      }

      const toInsert = []
      // For pickup: deadhead BEFORE main (seq+1, then seq+2)
      // For dropoff: return_leg AFTER main (main seq+1, paired seq+2)
      if (pairedRow) {
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
          crew_matches: actualCrew.map((c) => ({ crew_id: c.id, name: c.name })),
          crew_count: actualCrew.length,
          car: vehicleNo,
          matched_vehicle_id: null,
          is_adhoc_car: vehicleType === 'adhoc',
          ...base,
        }
        if (row.block_type === 'pickup') {
          toInsert.push({ ...newPaired, seq: maxSeq + 1 })
          toInsert.push({ ...newRow, seq: maxSeq + 2 })
        } else {
          toInsert.push({ ...newRow, seq: maxSeq + 1 })
          toInsert.push({ ...newPaired, seq: maxSeq + 2 })
        }
      } else {
        toInsert.push({ ...newRow, seq: maxSeq + 1 })
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

    // ── Crew split: insert new rows for planned crew not in actualCrew ──
    // (only when NOT in isNew / editMode single-crew dispatch)
    if (!editMode) {
      const remainingMatches = (row.crew_matches ?? []).filter(
        (m) => m.crew_id && !actualCrew.find((c) => c.id === m.crew_id),
      )

      if (remainingMatches.length > 0) {
        const maxSeq = Math.max(
          ...((rows ?? []).filter((r) => !r.isExtra).map((r) => r.seq || 0)),
          0,
        )
        const remainingNames = remainingMatches.map((m) => m.name).join(', ')

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
          planned_km: row.planned_km,
          crew_raw: remainingNames,
          crew_matches: remainingMatches,
          crew_count: remainingMatches.length,
          car: row.car,
          matched_vehicle_id: row.matched_vehicle_id,
          is_adhoc_car: row.is_adhoc_car ?? false,
          status: 'pending',
        }

        const toInsert = []

        if (pairedRow) {
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
            planned_km: pairedRow.planned_km,
            crew_raw: remainingNames,
            crew_matches: remainingMatches,
            crew_count: remainingMatches.length,
            car: pairedRow.car,
            matched_vehicle_id: pairedRow.matched_vehicle_id,
            is_adhoc_car: pairedRow.is_adhoc_car ?? false,
            status: 'pending',
          }
          if (row.block_type === 'pickup') {
            toInsert.push({ ...newPaired, seq: maxSeq + 1 })
            toInsert.push({ ...newMain, seq: maxSeq + 2 })
          } else {
            toInsert.push({ ...newMain, seq: maxSeq + 1 })
            toInsert.push({ ...newPaired, seq: maxSeq + 2 })
          }
        } else {
          toInsert.push({ ...newMain, seq: maxSeq + 1 })
        }

        const { error: e2 } = await supabase.from('ride_plan_rows').insert(toInsert)
        if (e2) toast.error('Split rows insert failed: ' + e2.message)
        else toast.success(`Split: ${remainingMatches.length} crew added as new row(s)`)
      } else {
        toast.success('Report saved')
      }
    } else {
      toast.success('Report updated')
    }

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
      size="full"
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
      <form id="qrm-form" className="ride-view ride-view--split" onSubmit={handleSubmit}>
        {/* ── Left column: form ── */}
        <div className="ride-view-info modal-form">
          <p className="qrm-subtitle">
            {row.plan_date} &nbsp;·&nbsp; {row.origin} → {row.destination}
            {routeLoading && <span className="secondary" style={{ fontSize: 11 }}> Calculating…</span>}
            {!routeLoading && routeData?.distanceKm != null && (
              <span className="qrm-km-badge">
                {Number(routeData.distanceKm).toFixed(2)} km
              </span>
            )}
          </p>

          {/* ── Crew ── */}
          <div className="field">
            <label>Crew</label>
            <div className="qrm-crew-list">
              {actualCrew.map((c) => (
                <span key={c.id} className="qrm-crew-tag">
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

          {/* ── Reason (required checkboxes) ── */}
          <div className="field">
            <label>
              Reason <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <div className="rp-reason-checklist">
              {NO_REASON_OPTIONS.map((opt) => (
                <label key={opt} className="rp-reason-check">
                  <input
                    type="checkbox"
                    checked={reasons.includes(opt)}
                    onChange={() => toggleReason(opt)}
                  />
                  {opt}
                </label>
              ))}
            </div>
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

        {/* ── Right column: map ── */}
        <div className="ride-view-map">
          <RouteMap
            points={routePts}
            line={routeData?.line ?? null}
            totalKm={routeData?.distanceKm ?? null}
            height="calc(100vh - 240px)"
          />
        </div>
      </form>
    </Modal>
  )
}
