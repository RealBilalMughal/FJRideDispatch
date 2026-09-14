import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Camera, CheckCircle2, LogOut } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { fmtDate } from '../lib/format'
import { pkToday, addDays } from '../lib/time'
import './DriverOdometer.css'

async function uploadPhoto(vehicleId, logDate, file) {
  const ext = file.name.split('.').pop()
  const path = `${vehicleId}/${logDate}_${Date.now()}.${ext}`
  const { error } = await supabase.storage
    .from('odometer-images')
    .upload(path, file, { upsert: true })
  if (error) return { url: null, error }
  const { data: { publicUrl } } = supabase.storage.from('odometer-images').getPublicUrl(path)
  return { url: publicUrl, error: null }
}

async function getPrevReading(vehicleId, beforeDate) {
  const { data } = await supabase
    .from('vehicle_odometer_logs')
    .select('km_reading')
    .eq('vehicle_id', vehicleId)
    .lt('log_date', beforeDate)
    .order('log_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.km_reading ?? null
}

async function checkExisting(vehicleId, logDate) {
  const { data } = await supabase
    .from('vehicle_odometer_logs')
    .select('id')
    .eq('vehicle_id', vehicleId)
    .eq('log_date', logDate)
    .maybeSingle()
  return Boolean(data)
}

export default function DriverOdometer() {
  const { profile, signOut } = useAuth()

  // assigned vehicle
  const [vehicle, setVehicle] = useState(null)
  const [vehicleLoading, setVehicleLoading] = useState(true)

  // date
  const [logDate, setLogDate] = useState(pkToday())
  const [prevDay, setPrevDay] = useState(false)

  // backup mode
  const [isBackup, setIsBackup] = useState(false)
  const [backupVehicleNo, setBackupVehicleNo] = useState('')
  const [backupVehicle, setBackupVehicle] = useState(null)   // resolved { id, vehicle_no, city_id }
  const [backupVehicleErr, setBackupVehicleErr] = useState('')
  const [backupVehicleLooking, setBackupVehicleLooking] = useState(false)

  // backup vehicle fields
  const [backupKm, setBackupKm] = useState('')
  const [backupImageFile, setBackupImageFile] = useState(null)
  const [backupImagePreview, setBackupImagePreview] = useState(null)
  const backupFileRef = useRef(null)

  // original vehicle closing fields (backup mode only)
  const [closingKm, setClosingKm] = useState('')
  const [closingImageFile, setClosingImageFile] = useState(null)
  const [closingImagePreview, setClosingImagePreview] = useState(null)
  const closingFileRef = useRef(null)

  // normal mode fields
  const [kmReading, setKmReading] = useState('')
  const [notes, setNotes] = useState('')
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const normalFileRef = useRef(null)

  const [saving, setSaving] = useState(false)
  const [recent, setRecent] = useState([])

  // ── load assigned vehicle ──────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      setVehicleLoading(true)
      const { data: driverRows } = await supabase
        .from('drivers')
        .select('id')
        .eq('contact', profile?.phone ?? '')
        .limit(1)
      const driverId = driverRows?.[0]?.id
      if (driverId) {
        const { data: vData } = await supabase
          .from('vehicles')
          .select('id, vehicle_no, city_id')
          .eq('is_active', true)
          .or(`driver_id.eq.${driverId},night_driver_id.eq.${driverId}`)
          .limit(1)
          .maybeSingle()
        if (vData) setVehicle(vData)
      }
      setVehicleLoading(false)
    }
    load()
  }, [profile?.phone])

  // ── date sync ─────────────────────────────────────────────────
  useEffect(() => {
    setLogDate(prevDay ? addDays(pkToday(), -1) : pkToday())
  }, [prevDay])

  useEffect(() => {
    const pkHour = new Date(Date.now() + 5 * 60 * 60 * 1000).getUTCHours()
    if (pkHour >= 23) setPrevDay(true)
  }, [])

  // ── recent readings ───────────────────────────────────────────
  useEffect(() => {
    if (!vehicle?.id) { setRecent([]); return }
    const since = addDays(pkToday(), -7)
    supabase
      .from('vehicle_odometer_logs')
      .select('id, log_date, km_reading, daily_km, is_verified')
      .eq('vehicle_id', vehicle.id)
      .gte('log_date', since)
      .order('log_date', { ascending: false })
      .then(({ data }) => setRecent(data ?? []))
  }, [vehicle?.id])

  // ── backup vehicle lookup (debounced) ─────────────────────────
  useEffect(() => {
    const trimmed = backupVehicleNo.trim().toUpperCase()
    if (!trimmed) { setBackupVehicle(null); setBackupVehicleErr(''); return }
    const timer = setTimeout(async () => {
      setBackupVehicleLooking(true)
      setBackupVehicleErr('')
      const { data } = await supabase
        .from('vehicles')
        .select('id, vehicle_no, city_id')
        .ilike('vehicle_no', trimmed)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()
      setBackupVehicleLooking(false)
      if (data) {
        setBackupVehicle(data)
      } else {
        setBackupVehicle(null)
        setBackupVehicleErr('Vehicle not found in fleet')
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [backupVehicleNo])

  // ── reset backup fields when toggled off ──────────────────────
  const toggleBackup = (checked) => {
    setIsBackup(checked)
    if (!checked) {
      setBackupVehicleNo('')
      setBackupVehicle(null)
      setBackupVehicleErr('')
      setBackupKm('')
      setBackupImageFile(null)
      setBackupImagePreview(null)
      setClosingKm('')
      setClosingImageFile(null)
      setClosingImagePreview(null)
    }
  }

  // ── photo helpers ─────────────────────────────────────────────
  const makeFileHandler = (setFile, setPreview) => (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFile(file)
    setPreview(URL.createObjectURL(file))
  }

  const makeDrop = (setFile, setPreview) => (e) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    setFile(file)
    setPreview(URL.createObjectURL(file))
  }

  const removePhoto = (setFile, setPreview, ref) => () => {
    setFile(null)
    setPreview(null)
    if (ref.current) ref.current.value = ''
  }

  // ── submit ────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)

    if (isBackup) {
      // ── BACKUP MODE ───────────────────────────────────────────
      const bKm = parseFloat(backupKm)
      const cKm = parseFloat(closingKm)

      if (!backupVehicle) { toast.error('Enter a valid backup vehicle number'); setSaving(false); return }
      if (!Number.isFinite(bKm) || bKm < 0) { toast.error('Enter backup vehicle KM reading'); setSaving(false); return }
      if (!backupImageFile) { toast.error('Backup vehicle photo is required'); setSaving(false); return }
      if (!vehicle) { toast.error('Your original vehicle could not be determined'); setSaving(false); return }
      if (!Number.isFinite(cKm) || cKm < 0) { toast.error('Enter closing KM for your original vehicle'); setSaving(false); return }

      // duplicate checks
      if (await checkExisting(backupVehicle.id, logDate)) {
        toast.error(`Backup vehicle already has a reading for ${fmtDate(logDate)}`)
        setSaving(false); return
      }
      if (await checkExisting(vehicle.id, logDate)) {
        toast.error(`Your original vehicle already has a closing reading for ${fmtDate(logDate)}`)
        setSaving(false); return
      }

      // upload backup photo
      const { url: bUrl, error: bUploadErr } = await uploadPhoto(backupVehicle.id, logDate, backupImageFile)
      if (bUploadErr) { toast.error('Backup vehicle photo upload failed'); setSaving(false); return }

      // upload closing photo (optional)
      let cUrl = null
      if (closingImageFile) {
        const { url, error: cUploadErr } = await uploadPhoto(vehicle.id, `${logDate}-closing`, closingImageFile)
        if (cUploadErr) { toast.error('Closing photo upload failed'); setSaving(false); return }
        cUrl = url
      }

      // daily_km for both
      const bPrev = await getPrevReading(backupVehicle.id, logDate)
      const cPrev = await getPrevReading(vehicle.id, logDate)
      const bDailyKm = bPrev != null ? +(bKm - bPrev).toFixed(1) : null
      const cDailyKm = cPrev != null ? +(cKm - cPrev).toFixed(1) : null

      // insert backup vehicle reading
      const { error: bErr } = await supabase.from('vehicle_odometer_logs').insert({
        vehicle_id: backupVehicle.id,
        log_date: logDate,
        city_id: backupVehicle.city_id,
        km_reading: bKm,
        daily_km: bDailyKm,
        image_url: bUrl,
        notes: `Backup vehicle (original: ${vehicle.vehicle_no})`,
        recorded_by: profile.id,
        is_verified: false,
      })
      if (bErr) { toast.error('Failed to save backup vehicle reading'); setSaving(false); return }

      // insert original vehicle closing reading
      const { error: cErr } = await supabase.from('vehicle_odometer_logs').insert({
        vehicle_id: vehicle.id,
        log_date: logDate,
        city_id: vehicle.city_id,
        km_reading: cKm,
        daily_km: cDailyKm,
        image_url: cUrl,
        notes: `Closing KM (driver on backup: ${backupVehicle.vehicle_no})`,
        recorded_by: profile.id,
        is_verified: false,
      })
      if (cErr) { toast.error('Backup reading saved but original vehicle closing failed'); setSaving(false); return }

      toast.success('Both readings saved!')
      setBackupVehicleNo('')
      setBackupVehicle(null)
      setBackupVehicleErr('')
      setBackupKm('')
      setBackupImageFile(null)
      setBackupImagePreview(null)
      setClosingKm('')
      setClosingImageFile(null)
      setClosingImagePreview(null)
      setIsBackup(false)

    } else {
      // ── NORMAL MODE ───────────────────────────────────────────
      const km = parseFloat(kmReading)
      if (!vehicle?.id) { toast.error('No vehicle assigned to your account'); setSaving(false); return }
      if (!Number.isFinite(km) || km < 0) { toast.error('Enter a valid KM reading'); setSaving(false); return }
      if (!imageFile) { toast.error('Photo is required'); setSaving(false); return }

      if (await checkExisting(vehicle.id, logDate)) {
        toast.error(`A reading for ${fmtDate(logDate)} already exists for this vehicle.`)
        setSaving(false); return
      }

      const { url: imgUrl, error: uploadErr } = await uploadPhoto(vehicle.id, logDate, imageFile)
      if (uploadErr) { toast.error('Image upload failed. Please try again.'); setSaving(false); return }

      const prevKm = await getPrevReading(vehicle.id, logDate)
      const dailyKm = prevKm != null ? +(km - prevKm).toFixed(1) : null

      const { error } = await supabase.from('vehicle_odometer_logs').insert({
        vehicle_id: vehicle.id,
        log_date: logDate,
        city_id: vehicle.city_id,
        km_reading: km,
        daily_km: dailyKm,
        image_url: imgUrl,
        notes: notes.trim() || null,
        recorded_by: profile.id,
        is_verified: false,
      })

      if (error) { toast.error('Failed to save reading'); setSaving(false); return }

      toast.success('Reading saved!')
      setKmReading('')
      setNotes('')
      setImageFile(null)
      setImagePreview(null)
      if (normalFileRef.current) normalFileRef.current.value = ''

      // refresh recent
      const since = addDays(pkToday(), -7)
      const { data: updated } = await supabase
        .from('vehicle_odometer_logs')
        .select('id, log_date, km_reading, daily_km, is_verified')
        .eq('vehicle_id', vehicle.id)
        .gte('log_date', since)
        .order('log_date', { ascending: false })
      setRecent(updated ?? [])
    }

    setSaving(false)
  }

  const todayDone = !isBackup && recent.some(r => r.log_date === logDate)

  return (
    <div className="drv-wrap">
      <header className="drv-head">
        <img src="/logo.png" alt="BusCaro" className="drv-logo" />
        <button type="button" className="drv-signout" onClick={signOut} title="Sign out">
          <LogOut size={16} />
        </button>
      </header>

      <main className="drv-main">
        <h1 className="drv-title">Vehicle KM Reading</h1>
        <p className="drv-sub">Record today's odometer reading for your vehicle.</p>

        <form className="drv-form" onSubmit={handleSubmit}>

          {/* Date row — always visible */}
          <div className="field">
            <label>Date</label>
            <div className="drv-date-row">
              <div className="input drv-date-display">{fmtDate(logDate)}</div>
              <label className="check-line drv-prev-check">
                <input type="checkbox" checked={prevDay} onChange={e => setPrevDay(e.target.checked)} />
                Previous day (night shift)
              </label>
            </div>
          </div>

          {/* Backup toggle */}
          <label className="check-line drv-backup-check">
            <input
              type="checkbox"
              checked={isBackup}
              onChange={e => toggleBackup(e.target.checked)}
              disabled={!vehicle && !vehicleLoading}
            />
            <span>Using a backup vehicle today?</span>
          </label>

          {/* ── NORMAL MODE ──────────────────────────────────────── */}
          {!isBackup && (
            <>
              {/* Vehicle locked */}
              <div className="field">
                <label>Vehicle</label>
                {vehicleLoading ? (
                  <div className="input drv-vehicle-locked drv-vehicle-loading">Loading…</div>
                ) : vehicle ? (
                  <div className="input drv-vehicle-locked">{vehicle.vehicle_no}</div>
                ) : (
                  <div className="drv-no-vehicle">No vehicle is assigned to your account. Contact your supervisor.</div>
                )}
              </div>

              {todayDone && (
                <div className="drv-already">
                  <CheckCircle2 size={13} /> Reading already recorded for {fmtDate(logDate)}
                </div>
              )}

              <div className="field">
                <label>KM Reading</label>
                <div className="drv-km-row">
                  <input className="input" type="number" min="0" step="0.1" placeholder="e.g. 45230.5"
                    value={kmReading} onChange={e => setKmReading(e.target.value)} required={!isBackup} />
                  <span className="drv-km-unit">km</span>
                </div>
              </div>

              <PhotoField
                label="Photo"
                required
                preview={imagePreview}
                fileRef={normalFileRef}
                onChange={makeFileHandler(setImageFile, setImagePreview)}
                onDrop={makeDrop(setImageFile, setImagePreview)}
                onRemove={removePhoto(setImageFile, setImagePreview, normalFileRef)}
              />

              <div className="field">
                <label>Notes <span className="field-hint">(optional)</span></label>
                <textarea className="input" rows={2} placeholder="Any notes…"
                  value={notes} onChange={e => setNotes(e.target.value)} />
              </div>

              <button type="submit" className="btn drv-submit" disabled={saving || todayDone || !vehicle}>
                {saving ? 'Saving…' : todayDone ? `Already recorded for ${fmtDate(logDate)}` : 'Submit Reading'}
              </button>
            </>
          )}

          {/* ── BACKUP MODE ──────────────────────────────────────── */}
          {isBackup && (
            <>
              {/* Section 1: Backup vehicle */}
              <div className="drv-section-head">Backup Vehicle</div>

              <div className="field">
                <label>Backup Vehicle No <span className="drv-required">*</span></label>
                <div className="drv-km-row">
                  <input
                    className={`input${backupVehicleErr ? ' input-error' : ''}`}
                    type="text"
                    placeholder="e.g. LHR-1234"
                    value={backupVehicleNo}
                    onChange={e => setBackupVehicleNo(e.target.value)}
                    autoCapitalize="characters"
                  />
                  {backupVehicleLooking && <span className="drv-km-unit">…</span>}
                  {backupVehicle && !backupVehicleLooking && (
                    <span className="drv-vehicle-found">✓</span>
                  )}
                </div>
                {backupVehicleErr && <div className="drv-field-err">{backupVehicleErr}</div>}
                {backupVehicle && (
                  <div className="drv-vehicle-confirmed">{backupVehicle.vehicle_no} — found</div>
                )}
              </div>

              <div className="field">
                <label>KM Reading <span className="drv-required">*</span></label>
                <div className="drv-km-row">
                  <input className="input" type="number" min="0" step="0.1" placeholder="Backup vehicle odometer"
                    value={backupKm} onChange={e => setBackupKm(e.target.value)} />
                  <span className="drv-km-unit">km</span>
                </div>
              </div>

              <PhotoField
                label="Photo"
                required
                preview={backupImagePreview}
                fileRef={backupFileRef}
                onChange={makeFileHandler(setBackupImageFile, setBackupImagePreview)}
                onDrop={makeDrop(setBackupImageFile, setBackupImagePreview)}
                onRemove={removePhoto(setBackupImageFile, setBackupImagePreview, backupFileRef)}
              />

              {/* Section 2: Original vehicle closing KM */}
              <div className="drv-section-head drv-section-sep">
                Original Vehicle
                {vehicle && <span className="drv-section-sub"> — {vehicle.vehicle_no} — Closing KM</span>}
              </div>

              {vehicleLoading ? (
                <div className="drv-vehicle-loading" style={{ fontSize: 13 }}>Loading assigned vehicle…</div>
              ) : !vehicle ? (
                <div className="drv-field-err">Could not determine your assigned vehicle.</div>
              ) : (
                <>
                  <div className="field">
                    <label>Closing KM Reading <span className="drv-required">*</span></label>
                    <div className="drv-km-row">
                      <input className="input" type="number" min="0" step="0.1"
                        placeholder={`${vehicle.vehicle_no} odometer`}
                        value={closingKm} onChange={e => setClosingKm(e.target.value)} />
                      <span className="drv-km-unit">km</span>
                    </div>
                  </div>

                  <PhotoField
                    label="Photo"
                    hint="optional"
                    preview={closingImagePreview}
                    fileRef={closingFileRef}
                    onChange={makeFileHandler(setClosingImageFile, setClosingImagePreview)}
                    onDrop={makeDrop(setClosingImageFile, setClosingImagePreview)}
                    onRemove={removePhoto(setClosingImageFile, setClosingImagePreview, closingFileRef)}
                  />
                </>
              )}

              <button type="submit" className="btn drv-submit" disabled={saving || !backupVehicle || !vehicle}>
                {saving ? 'Saving both readings…' : 'Submit Both Readings'}
              </button>
            </>
          )}
        </form>

        {/* Recent readings — normal mode only */}
        {!isBackup && recent.length > 0 && (
          <div className="drv-recent">
            <h2>Last 7 Days — {vehicle?.vehicle_no}</h2>
            <table className="drv-recent-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>KM</th>
                  <th>Daily KM</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(r => (
                  <tr key={r.id}>
                    <td>{fmtDate(r.log_date)}</td>
                    <td>{r.km_reading.toLocaleString()}</td>
                    <td>{r.daily_km != null ? r.daily_km.toLocaleString() : '—'}</td>
                    <td>
                      {r.is_verified
                        ? <span className="drv-status-v">Verified</span>
                        : <span className="drv-status-p">Pending</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}

function PhotoField({ label, required, hint, preview, fileRef, onChange, onDrop, onRemove }) {
  return (
    <div className="field">
      <label>
        {label}
        {required && <span className="drv-required"> *</span>}
        {hint && <span className="field-hint"> ({hint})</span>}
      </label>
      <div
        className={`drv-upload${preview ? ' has-image' : ''}`}
        onClick={() => fileRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={onDrop}
      >
        {preview ? (
          <img src={preview} alt="Preview" className="drv-upload-preview" />
        ) : (
          <div className="drv-upload-placeholder">
            <Camera size={28} />
            <span>Tap to take photo or upload</span>
          </div>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onChange} />
      {preview && (
        <button type="button" className="drv-remove-img" onClick={onRemove}>
          Remove photo
        </button>
      )}
    </div>
  )
}
