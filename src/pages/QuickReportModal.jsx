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

function initCrewFromRow(row, crew) {
  return (row.crew_matches ?? [])
    .filter((m) => m.crew_id)
    .map((m) => crew.find((c) => c.id === m.crew_id) ?? { id: m.crew_id, name: m.name })
    .filter(Boolean)
}

export default function QuickReportModal({ row, pairedRow, crew, vehicles, cityId, city, onDone, onClose }) {
  const { profile } = useAuth()

  const [actualCrew, setActualCrew] = useState(() => initCrewFromRow(row, crew))
  const [vehicleMode, setVehicleMode] = useState('same')
  const [vehicleType, setVehicleType] = useState('fleet')
  const [fleetVehicleId, setFleetVehicleId] = useState('')
  const [adhocNo, setAdhocNo] = useState('')
  const [reason, setReason] = useState('')
  const [remarks, setRemarks] = useState('')
  const [routeData, setRouteData] = useState(null) // { distanceKm, line }
  const [routeLoading, setRouteLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const routeAbort = useRef(null)

  // Auto-assign Ad-Hoc number (same logic as RideModal)
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

  // Recompute route when actualCrew changes
  useEffect(() => {
    if (routeAbort.current) { routeAbort.current = false }
    const airport = city
      ? { name: city.airport_name, lat: city.airport_lat, lng: city.airport_lng }
      : {}
    const pts = buildRoutePoints(row.block_type, null, actualCrew, airport)
    if (!routeComplete(pts)) {
      setRouteData(null)
      return
    }
    let alive = true
    routeAbort.current = true
    setRouteLoading(true)
    routeInfo(pts.map((p) => [p.lng, p.lat])).then((info) => {
      if (!alive) return
      setRouteData(info ?? null)
      setRouteLoading(false)
    }).catch(() => {
      if (alive) setRouteLoading(false)
    })
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

  const vehicleOptions = vehicles
    .filter((v) => v.city_id === cityId)
    .map((v) => ({ value: v.id, label: v.vehicle_no }))

  const resolvedVehicleNo = () => {
    if (vehicleMode === 'same') return row.car || null
    if (vehicleType === 'fleet') return vehicles.find((v) => v.id === fleetVehicleId)?.vehicle_no || null
    return adhocNo || null
  }

  // Build route points for RouteMap display
  const airport = city
    ? { name: city.airport_name, lat: city.airport_lat, lng: city.airport_lng }
    : {}
  const routePts = buildRoutePoints(row.block_type, null, actualCrew, airport)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setBusy(true)

    const crewNames = actualCrew.map((c) => c.name).join(', ') || null
    const vehicleNo = resolvedVehicleNo()
    const now = new Date().toISOString()
    const reporter = (profile?.full_name || '').trim() || profile?.email || ''
    const kmVal = routeData?.distanceKm != null ? parseFloat(routeData.distanceKm.toFixed(2)) : null

    const base = {
      status: 'followed',
      via_no: false,
      actual_crew_names: crewNames,
      actual_vehicle_no: vehicleNo,
      actual_km: kmVal,
      report_reason: reason.trim() || null,
      report_remarks: remarks.trim() || null,
      reported_by_name: reporter || null,
      reported_at: now,
    }

    const { error: e1 } = await supabase
      .from('ride_plan_rows')
      .update(base)
      .eq('id', row.id)

    if (e1) { toast.error('Save failed: ' + e1.message); setBusy(false); return }

    // Update paired row (deadhead / return leg) silently with same crew/vehicle
    if (pairedRow) {
      await supabase
        .from('ride_plan_rows')
        .update({ ...base })
        .eq('id', pairedRow.id)
    }

    toast.success('Report saved')
    setBusy(false)
    onDone()
  }

  const blockLabel = row.block_type?.replace('_', ' ') || '—'

  return (
    <Modal
      open
      size="full"
      title={`Report · ${blockLabel} · ${row.flight_no || '—'}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form="qrm-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save Report'}
          </button>
        </>
      }
    >
      <div className="ride-view ride-view--split">
        {/* ── Left column: form ── */}
        <div className="ride-view-info modal-form">
          <form id="qrm-form" onSubmit={handleSubmit}>
            <p className="qrm-subtitle">
              {row.plan_date} &nbsp;·&nbsp; {row.origin} → {row.destination}
              {routeData?.distanceKm != null && (
                <span className="qrm-km-badge">
                  {Number(routeData.distanceKm).toFixed(2)} km
                  {routeLoading && ' …'}
                </span>
              )}
              {routeLoading && routeData == null && (
                <span className="qrm-km-badge secondary"> Calculating…</span>
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

            {/* ── Reason ── */}
            <div className="field">
              <label>Reason <span className="field-hint">(optional)</span></label>
              <input
                className="input"
                type="text"
                placeholder="What changed from plan?"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>

            {/* ── Remarks ── */}
            <div className="field">
              <label>Remarks <span className="field-hint">(optional)</span></label>
              <textarea
                className="textarea"
                rows={3}
                placeholder="Additional notes…"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>
          </form>
        </div>

        {/* ── Right column: map ── */}
        <div className="ride-view-map">
          <RouteMap
            points={routePts}
            line={routeData?.line ?? null}
            totalKm={routeData?.distanceKm ?? null}
          />
        </div>
      </div>
    </Modal>
  )
}
