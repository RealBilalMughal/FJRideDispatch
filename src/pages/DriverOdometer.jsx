import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { ArrowLeft, Camera, CheckCircle2, LogOut, MapPin, RotateCcw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { fmtDate } from '../lib/format'
import { pkToday, addDays, fmtTimeOnly12 } from '../lib/time'
import './DriverOdometer.css'

async function uploadPhoto(storageId, logDate, suffix, file) {
  const ext = file.name.split('.').pop()
  const path = `${storageId}/${logDate}_${suffix}_${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('odometer-images').upload(path, file, { upsert: true })
  if (error) return { url: null, error }
  const { data: { publicUrl } } = supabase.storage.from('odometer-images').getPublicUrl(path)
  return { url: publicUrl, error: null }
}

async function getPrevReading(vehicleId, upToDate) {
  const { data } = await supabase
    .from('vehicle_odometer_logs').select('km_reading')
    .eq('vehicle_id', vehicleId).lte('log_date', upToDate)
    .order('log_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1).maybeSingle()
  return data?.km_reading ?? null
}

async function checkExisting(vehicleId, logDate, recordedBy, readingType = 'daily') {
  const { data } = await supabase
    .from('vehicle_odometer_logs').select('id')
    .eq('vehicle_id', vehicleId).eq('log_date', logDate)
    .eq('recorded_by', recordedBy).eq('reading_type', readingType).maybeSingle()
  return Boolean(data)
}

function useGeo() {
  const [coords, setCoords] = useState(null) // {lat, lng}
  useEffect(() => {
    if (!navigator?.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { timeout: 10000, maximumAge: 120000 },
    )
  }, [])
  return coords
}

export default function DriverOdometer() {
  const { profile, signOut } = useAuth()
  const geoCoords = useGeo()

  const [vehicle, setVehicle]               = useState(null)
  const [vehicleLoading, setVehicleLoading] = useState(true)
  const [logDate, setLogDate]               = useState(pkToday())
  const [prevDay, setPrevDay]               = useState(false)

  // mode: 'normal' | 'backup' | 'return'
  const [mode, setMode] = useState('normal')

  // ── normal / return mode ───────────────────────────────────────
  const [kmReading, setKmReading]       = useState('')
  const [imageFile, setImageFile]       = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const normalFileRef = useRef(null)

  // ── backup mode ────────────────────────────────────────────────
  // section 1 — original vehicle closing KM (top)
  const [closingKm, setClosingKm]               = useState('')
  const [closingImageFile, setClosingImageFile] = useState(null)
  const [closingImagePreview, setClosingImagePreview] = useState(null)
  const closingFileRef = useRef(null)

  // section 2 — backup vehicle (bottom)
  const [backupVehicleNo, setBackupVehicleNo]   = useState('')
  const [backupVehicle, setBackupVehicle]       = useState(null)
  const [backupLooking, setBackupLooking]       = useState(false)
  const [backupKm, setBackupKm]                 = useState('')
  const [backupImageFile, setBackupImageFile]   = useState(null)
  const [backupImagePreview, setBackupImagePreview] = useState(null)
  const backupFileRef = useRef(null)

  const [saving, setSaving] = useState(false)

  // ── today's status ─────────────────────────────────────────────
  const [todayDone, setTodayDone]       = useState(false) // 'daily' reading
  const [closingDone, setClosingDone]   = useState(false) // 'closing' reading
  const [returnDone, setReturnDone]     = useState(false) // 'return' reading

  // ── load assigned vehicle ──────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      setVehicleLoading(true)
      const { data: driverRows } = await supabase.from('drivers').select('id')
        .eq('contact', profile?.phone ?? '').limit(1)
      const driverId = driverRows?.[0]?.id
      if (driverId) {
        const { data: vData } = await supabase.from('vehicles')
          .select('id, vehicle_no, city_id').eq('is_active', true)
          .or(`driver_id.eq.${driverId},night_driver_id.eq.${driverId}`)
          .limit(1).maybeSingle()
        if (vData) setVehicle(vData)
      }
      setVehicleLoading(false)
    }
    load()
  }, [profile?.phone])

  useEffect(() => {
    setLogDate(prevDay ? addDays(pkToday(), -1) : pkToday())
  }, [prevDay])

  useEffect(() => {
    const pkHour = new Date(Date.now() + 5 * 60 * 60 * 1000).getUTCHours()
    if (pkHour >= 23) setPrevDay(true)
  }, [])

  useEffect(() => {
    if (!vehicle?.id || !profile?.id) { setTodayDone(false); setClosingDone(false); setReturnDone(false); return }
    Promise.all([
      checkExisting(vehicle.id, logDate, profile.id, 'daily'),
      checkExisting(vehicle.id, logDate, profile.id, 'closing'),
      checkExisting(vehicle.id, logDate, profile.id, 'return'),
    ]).then(([d, c, r]) => { setTodayDone(d); setClosingDone(c); setReturnDone(r) })
  }, [vehicle?.id, logDate, profile?.id])

  // ── backup vehicle lookup ──────────────────────────────────────
  useEffect(() => {
    const trimmed = backupVehicleNo.trim()
    if (!trimmed) { setBackupVehicle(null); return }
    const timer = setTimeout(async () => {
      setBackupLooking(true)
      const { data } = await supabase.from('vehicles').select('id, vehicle_no, city_id')
        .ilike('vehicle_no', `%${trimmed}%`).limit(1).maybeSingle()
      setBackupLooking(false)
      setBackupVehicle(data ?? null)
    }, 500)
    return () => clearTimeout(timer)
  }, [backupVehicleNo])

  const enterBackup = () => setMode('backup')
  const enterReturn = () => { setMode('return'); setKmReading(''); setImageFile(null); setImagePreview(null) }
  const exitSpecial  = () => {
    setMode('normal')
    setBackupVehicleNo(''); setBackupVehicle(null)
    setBackupKm(''); setBackupImageFile(null); setBackupImagePreview(null)
    setClosingKm(''); setClosingImageFile(null); setClosingImagePreview(null)
  }

  const pickPhoto = (setFile, setPreview) => (e) => {
    const file = e.target.files?.[0]; if (!file) return
    setFile(file); setPreview(URL.createObjectURL(file))
  }
  const dropPhoto = (setFile, setPreview) => (e) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]; if (!file) return
    setFile(file); setPreview(URL.createObjectURL(file))
  }
  const clearPhoto = (setFile, setPreview, ref) => () => {
    setFile(null); setPreview(null); if (ref.current) ref.current.value = ''
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)

    // ── BACKUP MODE ────────────────────────────────────────────────
    if (mode === 'backup') {
      const bVehicleNo = backupVehicleNo.trim()
      const bKm = parseFloat(backupKm)
      const cKm = parseFloat(closingKm)

      if (!vehicle)                            { toast.error('Your assigned vehicle could not be found'); setSaving(false); return }
      if (!Number.isFinite(cKm) || cKm < 0)   { toast.error('Enter closing KM for your original vehicle'); setSaving(false); return }
      if (!bVehicleNo)                         { toast.error('Enter the backup vehicle number'); setSaving(false); return }
      if (!Number.isFinite(bKm) || bKm < 0)   { toast.error('Enter backup vehicle KM reading'); setSaving(false); return }
      if (!backupImageFile)                    { toast.error('Backup vehicle photo is required'); setSaving(false); return }

      if (await checkExisting(vehicle.id, logDate, profile.id, 'closing')) {
        toast.error('Original vehicle closing KM already recorded for today'); setSaving(false); return
      }
      if (backupVehicle && await checkExisting(backupVehicle.id, logDate, profile.id, 'backup')) {
        toast.error('Backup vehicle reading already recorded for today'); setSaving(false); return
      }

      let cUrl = null
      if (closingImageFile) {
        const { url, error: cErr } = await uploadPhoto(vehicle.id, logDate, 'closing', closingImageFile)
        if (cErr) { toast.error('Closing photo upload failed'); setSaving(false); return }
        cUrl = url
      }

      const bStorageId = backupVehicle?.id ?? `untracked-${bVehicleNo.replace(/[^a-zA-Z0-9]/g, '-')}`
      const { url: bUrl, error: bErr } = await uploadPhoto(bStorageId, logDate, 'backup', backupImageFile)
      if (bErr) { toast.error('Backup photo upload failed'); setSaving(false); return }

      // save original vehicle closing KM
      const cPrev = await getPrevReading(vehicle.id, logDate)
      const { error: e1 } = await supabase.from('vehicle_odometer_logs').insert({
        vehicle_id: vehicle.id, log_date: logDate, city_id: vehicle.city_id,
        km_reading: cKm, daily_km: cPrev != null ? +(cKm - cPrev).toFixed(1) : null,
        image_url: cUrl, reading_type: 'closing',
        notes: `Closing KM — driver on backup: ${backupVehicle?.vehicle_no ?? bVehicleNo}`,
        recorded_by: profile.id, is_verified: false,
        submit_lat: geoCoords?.lat ?? null, submit_lng: geoCoords?.lng ?? null,
      })
      if (e1) { toast.error('Failed to save original vehicle closing KM'); setSaving(false); return }

      // save backup vehicle reading (only if it's a fleet vehicle)
      if (backupVehicle) {
        const bPrev = await getPrevReading(backupVehicle.id, logDate)
        const { error: e2 } = await supabase.from('vehicle_odometer_logs').insert({
          vehicle_id: backupVehicle.id, log_date: logDate, city_id: backupVehicle.city_id,
          km_reading: bKm, daily_km: bPrev != null ? +(bKm - bPrev).toFixed(1) : null,
          image_url: bUrl, reading_type: 'backup',
          notes: `Backup vehicle (original driver: ${vehicle.vehicle_no})`,
          recorded_by: profile.id, is_verified: false,
          submit_lat: geoCoords?.lat ?? null, submit_lng: geoCoords?.lng ?? null,
        })
        if (e2) { toast.error('Closing saved but backup vehicle reading failed'); setSaving(false); return }
      }

      toast.success('Readings saved!')
      exitSpecial()
      setClosingDone(true)

    // ── NORMAL / RETURN MODE ───────────────────────────────────────
    } else {
      const km = parseFloat(kmReading)
      const readingType = mode === 'return' ? 'return' : 'daily'
      if (!vehicle?.id)                       { toast.error('No vehicle assigned'); setSaving(false); return }
      if (!Number.isFinite(km) || km < 0)     { toast.error('Enter a valid KM reading'); setSaving(false); return }
      if (!imageFile)                         { toast.error('Photo is required'); setSaving(false); return }

      if (await checkExisting(vehicle.id, logDate, profile.id, readingType)) {
        toast.error(`Reading already recorded for ${fmtDate(logDate)}`)
        setSaving(false); return
      }

      const { url: imgUrl, error: uploadErr } = await uploadPhoto(vehicle.id, logDate, readingType, imageFile)
      if (uploadErr) { toast.error('Photo upload failed'); setSaving(false); return }

      const prevKm = await getPrevReading(vehicle.id, logDate)
      const { error } = await supabase.from('vehicle_odometer_logs').insert({
        vehicle_id: vehicle.id, log_date: logDate, city_id: vehicle.city_id,
        km_reading: km, daily_km: prevKm != null ? +(km - prevKm).toFixed(1) : null,
        image_url: imgUrl, reading_type: readingType,
        notes: mode === 'return' ? 'Vehicle returned — end of day reading' : null,
        recorded_by: profile.id, is_verified: false,
        submit_lat: geoCoords?.lat ?? null, submit_lng: geoCoords?.lng ?? null,
      })
      if (error) { toast.error('Failed to save reading'); setSaving(false); return }

      toast.success('Reading saved!')
      setKmReading(''); setImageFile(null); setImagePreview(null)
      if (normalFileRef.current) normalFileRef.current.value = ''
      if (mode === 'return') { setReturnDone(true); setMode('normal') }
      else setTodayDone(true)
    }

    setSaving(false)
  }

  // ── which timestamp to show after geo ──────────────────────────
  const pkNow = new Date(Date.now() + 5 * 60 * 60 * 1000)
  const timeStr = pkNow.toISOString().slice(11, 16) // HH:MM UTC which is PK time
  const fmtHHMM = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number)
    const ampm = h < 12 ? 'AM' : 'PM'
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`
  }

  return (
    <div className="drv-wrap">
      <header className="drv-head">
        <img src="/logo.png" alt="BusCaro" className="drv-logo" />
        <button type="button" className="drv-signout" onClick={signOut} title="Sign out">
          <LogOut size={16} />
        </button>
      </header>

      <main className="drv-main">

        {/* ── date bar ─────────────────────────────────────────── */}
        <div className="drv-datebar">
          <span className="drv-date-val">{fmtDate(logDate)} · {fmtHHMM(timeStr)}</span>
          <label className="drv-night-check">
            <input type="checkbox" checked={prevDay} onChange={e => setPrevDay(e.target.checked)} />
            Night shift
          </label>
        </div>

        {(mode === 'backup' || mode === 'return') && (
          <button type="button" className="drv-back-btn" onClick={exitSpecial}>
            <ArrowLeft size={14} /> {mode === 'return' ? 'Back' : 'Normal reading'}
          </button>
        )}

        <form className="drv-form" onSubmit={handleSubmit}>

          {/* ── NORMAL / RETURN MODE ─────────────────────────────── */}
          {(mode === 'normal' || mode === 'return') && (
            <>
              <div className="drv-vehicle-badge">
                {vehicleLoading ? (
                  <span className="drv-vbadge-no drv-vehicle-loading">Loading…</span>
                ) : vehicle ? (
                  <>
                    <span className="drv-vbadge-no">{vehicle.vehicle_no}</span>
                    <span className="drv-vbadge-label">
                      {mode === 'return' ? 'Vehicle returned — add reading' : 'Your assigned vehicle'}
                    </span>
                  </>
                ) : (
                  <span className="drv-no-vehicle">No vehicle assigned — contact supervisor</span>
                )}
              </div>

              {mode === 'normal' && todayDone ? (
                <div className="drv-done-notice">
                  <CheckCircle2 size={16} />
                  Reading recorded for {fmtDate(logDate)}
                </div>
              ) : (
                <>
                  <div className="drv-km-field">
                    <label className="drv-km-label">KM Reading</label>
                    <div className="drv-km-row">
                      <input className="input drv-km-input" type="number" min="0" step="0.1"
                        placeholder="0" value={kmReading} onChange={e => setKmReading(e.target.value)} />
                      <span className="drv-km-unit">km</span>
                    </div>
                  </div>

                  <div className="field">
                    <label>Photo <span className="drv-required">*</span></label>
                    <UploadBox preview={imagePreview} fileRef={normalFileRef}
                      onChange={pickPhoto(setImageFile, setImagePreview)}
                      onDrop={dropPhoto(setImageFile, setImagePreview)}
                      onRemove={clearPhoto(setImageFile, setImagePreview, normalFileRef)} />
                  </div>

                  <GeoBar coords={geoCoords} />

                  <button type="submit" className="btn drv-submit" disabled={saving || !vehicle}>
                    {saving ? 'Saving…' : mode === 'return' ? 'Submit Return Reading' : 'Submit Reading'}
                  </button>
                </>
              )}
            </>
          )}

          {/* ── BACKUP MODE ──────────────────────────────────────── */}
          {mode === 'backup' && (
            <>
              {/* ── SECTION 1: Original vehicle closing (top) ── */}
              <p className="drv-section-label">
                Original Vehicle{vehicle ? ` · ${vehicle.vehicle_no}` : ''} · Closing KM
              </p>

              {vehicleLoading ? (
                <p className="drv-vehicle-loading" style={{ fontSize: 13 }}>Loading…</p>
              ) : !vehicle ? (
                <p className="drv-field-err">Assigned vehicle not found.</p>
              ) : (
                <>
                  <div className="drv-km-field">
                    <label className="drv-km-label">Closing KM <span className="drv-required">*</span></label>
                    <div className="drv-km-row">
                      <input className="input drv-km-input" type="number" min="0" step="0.1"
                        placeholder="0" value={closingKm} onChange={e => setClosingKm(e.target.value)} />
                      <span className="drv-km-unit">km</span>
                    </div>
                  </div>

                  <div className="field">
                    <label>Photo <span className="field-hint">(optional)</span></label>
                    <UploadBox preview={closingImagePreview} fileRef={closingFileRef}
                      onChange={pickPhoto(setClosingImageFile, setClosingImagePreview)}
                      onDrop={dropPhoto(setClosingImageFile, setClosingImagePreview)}
                      onRemove={clearPhoto(setClosingImageFile, setClosingImagePreview, closingFileRef)} />
                  </div>
                </>
              )}

              {/* ── DIVIDER ── */}
              <div className="drv-section-divider">
                <span className="drv-section-divider-label">Backup Vehicle · Reading</span>
              </div>

              {/* ── SECTION 2: Backup vehicle (bottom) ── */}
              <div className="field">
                <label>Vehicle Number <span className="drv-required">*</span></label>
                <div className="drv-km-row">
                  <input className="input" type="text" placeholder="e.g. ALY-851"
                    autoCapitalize="characters"
                    value={backupVehicleNo} onChange={e => setBackupVehicleNo(e.target.value)} />
                  {backupLooking && <span className="drv-km-unit" style={{ minWidth: 16 }}>…</span>}
                  {backupVehicle && !backupLooking && <span className="drv-found-tick">✓</span>}
                </div>
                {backupVehicleNo.trim() && !backupLooking && !backupVehicle && (
                  <div className="drv-field-hint">Not in fleet — will be noted</div>
                )}
              </div>

              <div className="drv-km-field">
                <label className="drv-km-label">KM Reading <span className="drv-required">*</span></label>
                <div className="drv-km-row">
                  <input className="input drv-km-input" type="number" min="0" step="0.1"
                    placeholder="0" value={backupKm} onChange={e => setBackupKm(e.target.value)} />
                  <span className="drv-km-unit">km</span>
                </div>
              </div>

              <div className="field">
                <label>Photo <span className="drv-required">*</span></label>
                <UploadBox preview={backupImagePreview} fileRef={backupFileRef}
                  onChange={pickPhoto(setBackupImageFile, setBackupImagePreview)}
                  onDrop={dropPhoto(setBackupImageFile, setBackupImagePreview)}
                  onRemove={clearPhoto(setBackupImageFile, setBackupImagePreview, backupFileRef)} />
              </div>

              <GeoBar coords={geoCoords} />

              <button type="submit" className="btn drv-submit"
                disabled={saving || !backupVehicleNo.trim() || !vehicle}>
                {saving ? 'Saving…' : 'Submit Both Readings'}
              </button>
            </>
          )}

        </form>

        {/* ── action buttons below form ─────────────────────────── */}
        {mode === 'normal' && vehicle && (
          <div className="drv-bottom-actions">
            {!closingDone && (
              <button type="button" className="btn btn-ghost drv-backup-btn" onClick={enterBackup}>
                Using a backup vehicle today?
              </button>
            )}
            {(todayDone || closingDone) && !returnDone && (
              <button type="button" className="btn btn-ghost drv-backup-btn drv-return-btn" onClick={enterReturn}>
                <RotateCcw size={14} /> Original vehicle returned today
              </button>
            )}
          </div>
        )}

      </main>
    </div>
  )
}

function GeoBar({ coords }) {
  if (!coords) return null
  return (
    <div className="drv-geo-bar">
      <MapPin size={12} />
      <span>{coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}</span>
    </div>
  )
}

function UploadBox({ preview, fileRef, onChange, onDrop, onRemove }) {
  return (
    <>
      <div className={`drv-upload${preview ? ' has-image' : ''}`}
        onClick={() => fileRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={onDrop}>
        {preview
          ? <img src={preview} alt="Preview" className="drv-upload-preview" />
          : <div className="drv-upload-placeholder"><Camera size={18} /><span>Tap to capture</span></div>}
      </div>
      {/* capture="environment" forces back camera; no accept so gallery is not offered */}
      <input ref={fileRef} type="file" capture="environment" hidden onChange={onChange} />
      {preview && <button type="button" className="drv-remove-img" onClick={onRemove}>Remove</button>}
    </>
  )
}
