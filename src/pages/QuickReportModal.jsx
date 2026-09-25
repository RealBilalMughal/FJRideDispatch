import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import Modal from '../components/Modal'
import SearchSelect from '../components/SearchSelect'

// Initialise crew list from plan row's crew_matches (jsonb [{crew_id, name, ...}])
function initCrewFromRow(row, crew) {
  return (row.crew_matches ?? [])
    .filter((m) => m.crew_id)
    .map((m) => crew.find((c) => c.id === m.crew_id) ?? { id: m.crew_id, name: m.name })
    .filter(Boolean)
}

export default function QuickReportModal({ row, pairedRow, crew, vehicles, cityId, onDone, onClose }) {
  const { profile } = useAuth()

  const [actualCrew, setActualCrew] = useState(() => initCrewFromRow(row, crew))
  // vehicle: 'same' | 'different'
  const [vehicleMode, setVehicleMode] = useState('same')
  // when different: 'fleet' | 'adhoc'
  const [vehicleType, setVehicleType] = useState('fleet')
  const [fleetVehicleId, setFleetVehicleId] = useState('')
  const [adhocNo, setAdhocNo] = useState('')
  const [actualKm, setActualKm] = useState(row.planned_km != null ? String(row.planned_km) : '')
  const [pairedKm, setPairedKm] = useState(
    pairedRow?.planned_km != null ? String(pairedRow.planned_km) : '',
  )
  const [reason, setReason] = useState('')
  const [remarks, setRemarks] = useState('')
  const [busy, setBusy] = useState(false)

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

  // Clear adhocNo when switching away
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

  const handleSubmit = async (e) => {
    e.preventDefault()
    setBusy(true)

    const crewNames = actualCrew.map((c) => c.name).join(', ') || null
    const vehicleNo = resolvedVehicleNo()
    const now = new Date().toISOString()
    const reporter = (profile?.full_name || '').trim() || profile?.email || ''

    const base = {
      status: 'followed',
      via_no: false,
      actual_crew_names: crewNames,
      actual_vehicle_no: vehicleNo,
      report_reason: reason.trim() || null,
      report_remarks: remarks.trim() || null,
      reported_by_name: reporter || null,
      reported_at: now,
    }

    const { error: e1 } = await supabase
      .from('ride_plan_rows')
      .update({ ...base, actual_km: actualKm ? parseFloat(actualKm) : null })
      .eq('id', row.id)

    if (e1) { toast.error('Save failed: ' + e1.message); setBusy(false); return }

    if (pairedRow) {
      await supabase
        .from('ride_plan_rows')
        .update({ ...base, actual_km: pairedKm ? parseFloat(pairedKm) : null })
        .eq('id', pairedRow.id)
    }

    toast.success('Report saved')
    setBusy(false)
    onDone()
  }

  const pairedLabel = pairedRow?.block_type === 'deadhead' ? 'Deadhead' : 'Return Leg'

  return (
    <Modal
      title={`Report · ${row.block_type?.replace('_', ' ')} · ${row.flight_no || '—'}`}
      onClose={onClose}
      size="md"
    >
      <form className="modal-form qrm-form" onSubmit={handleSubmit}>
        <p className="qrm-subtitle">
          {row.plan_date} &nbsp;·&nbsp; {row.origin} → {row.destination}
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

        {/* ── Actual KM ── */}
        <div className="field">
          <label>Actual KM</label>
          <input
            className="input"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={actualKm}
            onChange={(e) => setActualKm(e.target.value)}
          />
        </div>

        {/* ── Paired row (deadhead / return leg) ── */}
        {pairedRow && (
          <div className="qrm-paired-section">
            <p className="qrm-paired-head">{pairedLabel}</p>
            <div className="field">
              <label>Crew <span className="secondary" style={{ fontSize: 11 }}>(same as above)</span></label>
              <p className="qrm-paired-crew">
                {actualCrew.length ? actualCrew.map((c) => c.name).join(', ') : '—'}
              </p>
            </div>
            <div className="field">
              <label>Actual KM</label>
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={pairedKm}
                onChange={(e) => setPairedKm(e.target.value)}
              />
            </div>
          </div>
        )}

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
            rows={2}
            placeholder="Additional notes…"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save Report'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
