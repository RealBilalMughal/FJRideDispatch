import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { ArrowLeft, Camera, CheckCircle2, LogOut } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { fmtDate } from '../lib/format'
import { pkToday, addDays } from '../lib/time'
import './DriverOdometer.css'

async function uploadPhoto(vehicleId, logDate, file) {
  const ext = file.name.split('.').pop()
  const path = `${vehicleId}/${logDate}_${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('odometer-images').upload(path, file, { upsert: true })
  if (error) return { url: null, error }
  const { data: { publicUrl } } = supabase.storage.from('odometer-images').getPublicUrl(path)
  return { url: publicUrl, error: null }
}

async function getPrevReading(vehicleId, upToDate) {
  // Include same-day earlier readings (backup vehicle used by 2 drivers)
  const { data } = await supabase
    .from('vehicle_odometer_logs').select('km_reading')
    .eq('vehicle_id', vehicleId).lte('log_date', upToDate)
    .order('log_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1).maybeSingle()
  return data?.km_reading ?? null
}

// Unique per vehicle + date + driver (not globally per vehicle+date)
async function checkExisting(vehicleId, logDate, recordedBy) {
  const { data } = await supabase
    .from('vehicle_odometer_logs').select('id')
    .eq('vehicle_id', vehicleId).eq('log_date', logDate)
    .eq('recorded_by', recordedBy).maybeSingle()
  return Boolean(data)
}

export default function DriverOdometer() {
  const { profile, signOut } = useAuth()

  const [vehicle, setVehicle]           = useState(null)
  const [vehicleLoading, setVehicleLoading] = useState(true)
  const [logDate, setLogDate]           = useState(pkToday())
  const [prevDay, setPrevDay]           = useState(false)
  const [mode, setMode]                 = useState('normal') // 'normal' | 'backup'

  // normal mode
  const [kmReading, setKmReading]       = useState('')
  const [imageFile, setImageFile]       = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const normalFileRef = useRef(null)

  // backup mode
  const [backupVehicleNo, setBackupVehicleNo]   = useState('')
  const [backupVehicle, setBackupVehicle]       = useState(null)
  const [backupVehicleErr, setBackupVehicleErr] = useState('')
  const [backupLooking, setBackupLooking]       = useState(false)
  const [backupKm, setBackupKm]                 = useState('')
  const [backupImageFile, setBackupImageFile]   = useState(null)
  const [backupImagePreview, setBackupImagePreview] = useState(null)
  const backupFileRef = useRef(null)
  const [closingKm, setClosingKm]               = useState('')
  const [closingImageFile, setClosingImageFile] = useState(null)
  const [closingImagePreview, setClosingImagePreview] = useState(null)
  const closingFileRef = useRef(null)

  const [saving, setSaving] = useState(false)

  // load assigned vehicle
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

  // backup vehicle lookup — flexible, any number allowed even if not in fleet
  useEffect(() => {
    const trimmed = backupVehicleNo.trim()
    if (!trimmed) { setBackupVehicle(null); setBackupVehicleErr(''); return }
    const timer = setTimeout(async () => {
      setBackupLooking(true); setBackupVehicleErr('')
      const { data } = await supabase.from('vehicles').select('id, vehicle_no, city_id')
        .ilike('vehicle_no', `%${trimmed}%`).limit(1).maybeSingle()
      setBackupLooking(false)
      if (data) { setBackupVehicle(data) }
      else { setBackupVehicle(null) } // not in fleet — allowed; will note only
    }, 500)
    return () => clearTimeout(timer)
  }, [backupVehicleNo])

  const enterBackup = () => setMode('backup')
  const exitBackup  = () => {
    setMode('normal')
    setBackupVehicleNo(''); setBackupVehicle(null); setBackupVehicleErr('')
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

    if (mode === 'backup') {
      const bKm = parseFloat(backupKm)
      const cKm = parseFloat(closingKm)
      const bVehicleNo = backupVehicleNo.trim()
      if (!bVehicleNo)                         { toast.error('Enter the backup vehicle number'); setSaving(false); return }
      if (!Number.isFinite(bKm) || bKm < 0)   { toast.error('Enter backup vehicle KM'); setSaving(false); return }
      if (!backupImageFile)                    { toast.error('Backup vehicle photo required'); setSaving(false); return }
      if (!vehicle)                            { toast.error('Your assigned vehicle could not be found'); setSaving(false); return }
      if (!Number.isFinite(cKm) || cKm < 0)   { toast.error('Enter closing KM for your original vehicle'); setSaving(false); return }

      if (backupVehicle && await checkExisting(backupVehicle.id, logDate, profile.id)) {
        toast.error(`You already recorded a reading for this backup vehicle today`)
        setSaving(false); return
      }
      if (await checkExisting(vehicle.id, logDate, profile.id)) {
        toast.error(`You already recorded a closing KM for your original vehicle today`)
        setSaving(false); return
      }

      // backup photo — use DB vehicle id if in fleet, else a freetext path
      const bStorageId = backupVehicle?.id ?? `untracked-${bVehicleNo.replace(/[^a-zA-Z0-9]/g, '-')}`
      const { url: bUrl, error: bErr } = await uploadPhoto(bStorageId, logDate, backupImageFile)
      if (bErr) { toast.error('Backup photo upload failed'); setSaving(false); return }

      let cUrl = null
      if (closingImageFile) {
        const { url, error: cErr } = await uploadPhoto(vehicle.id, `${logDate}-closing`, closingImageFile)
        if (cErr) { toast.error('Closing photo upload failed'); setSaving(false); return }
        cUrl = url
      }

      // only save a backup-vehicle log entry when it's a real fleet vehicle
      if (backupVehicle) {
        const bPrev = await getPrevReading(backupVehicle.id, logDate)
        const { error: e1 } = await supabase.from('vehicle_odometer_logs').insert({
          vehicle_id: backupVehicle.id, log_date: logDate, city_id: backupVehicle.city_id,
          km_reading: bKm, daily_km: bPrev != null ? +(bKm - bPrev).toFixed(1) : null,
          image_url: bUrl, notes: `Backup vehicle (original: ${vehicle.vehicle_no})`,
          recorded_by: profile.id, is_verified: false,
        })
        if (e1) { toast.error('Failed to save backup reading'); setSaving(false); return }
      }

      const cPrev = await getPrevReading(vehicle.id, logDate)
      const closingNote = backupVehicle
        ? `Closing KM — driver on backup: ${backupVehicle.vehicle_no}`
        : `Closing KM — driver on backup: ${bVehicleNo} (not in fleet, backup KM: ${bKm}, photo: ${bUrl})`
      const { error: e2 } = await supabase.from('vehicle_odometer_logs').insert({
        vehicle_id: vehicle.id, log_date: logDate, city_id: vehicle.city_id,
        km_reading: cKm, daily_km: cPrev != null ? +(cKm - cPrev).toFixed(1) : null,
        image_url: cUrl, notes: closingNote,
        recorded_by: profile.id, is_verified: false,
      })
      if (e2) {
        toast.error(backupVehicle ? 'Backup saved but original vehicle closing failed' : 'Failed to save closing KM')
        setSaving(false); return
      }

      toast.success('Readings saved!')
      exitBackup()

    } else {
      const km = parseFloat(kmReading)
      if (!vehicle?.id)                       { toast.error('No vehicle assigned'); setSaving(false); return }
      if (!Number.isFinite(km) || km < 0)     { toast.error('Enter a valid KM reading'); setSaving(false); return }
      if (!imageFile)                         { toast.error('Photo is required'); setSaving(false); return }

      if (await checkExisting(vehicle.id, logDate, profile.id)) {
        toast.error(`Reading already recorded for ${fmtDate(logDate)}`)
        setSaving(false); return
      }

      const { url: imgUrl, error: uploadErr } = await uploadPhoto(vehicle.id, logDate, imageFile)
      if (uploadErr) { toast.error('Photo upload failed'); setSaving(false); return }

      const prevKm = await getPrevReading(vehicle.id, logDate)
      const { error } = await supabase.from('vehicle_odometer_logs').insert({
        vehicle_id: vehicle.id, log_date: logDate, city_id: vehicle.city_id,
        km_reading: km, daily_km: prevKm != null ? +(km - prevKm).toFixed(1) : null,
        image_url: imgUrl, recorded_by: profile.id, is_verified: false,
      })
      if (error) { toast.error('Failed to save reading'); setSaving(false); return }

      toast.success('Reading saved!')
      setKmReading(''); setImageFile(null); setImagePreview(null)
      if (normalFileRef.current) normalFileRef.current.value = ''
      setTodayDone(true)
    }

    setSaving(false)
  }

  const [todayDone, setTodayDone] = useState(false)
  useEffect(() => {
    if (!vehicle?.id || !profile?.id) { setTodayDone(false); return }
    checkExisting(vehicle.id, logDate, profile.id).then(setTodayDone)
  }, [vehicle?.id, logDate, profile?.id])

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
          <span className="drv-date-val">{fmtDate(logDate)}</span>
          <label className="drv-night-check">
            <input type="checkbox" checked={prevDay} onChange={e => setPrevDay(e.target.checked)} />
            Night shift
          </label>
        </div>

        {mode === 'backup' && (
          <button type="button" className="drv-back-btn" onClick={exitBackup}>
            <ArrowLeft size={14} /> Normal reading
          </button>
        )}

        <form className="drv-form" onSubmit={handleSubmit}>

          {/* ── NORMAL MODE ──────────────────────────────────────── */}
          {mode === 'normal' && (
            <>
              {/* Vehicle badge */}
              <div className="drv-vehicle-badge">
                {vehicleLoading ? (
                  <span className="drv-vbadge-no drv-vehicle-loading">Loading…</span>
                ) : vehicle ? (
                  <>
                    <span className="drv-vbadge-no">{vehicle.vehicle_no}</span>
                    <span className="drv-vbadge-label">Your assigned vehicle</span>
                  </>
                ) : (
                  <span className="drv-no-vehicle">No vehicle assigned — contact supervisor</span>
                )}
              </div>

              {todayDone ? (
                <div className="drv-done-notice">
                  <CheckCircle2 size={16} />
                  Reading already recorded for {fmtDate(logDate)}
                </div>
              ) : (
                <>
                  {/* KM */}
                  <div className="drv-km-field">
                    <label className="drv-km-label">KM Reading</label>
                    <div className="drv-km-row">
                      <input className="input drv-km-input" type="number" min="0" step="0.1"
                        placeholder="0" value={kmReading} onChange={e => setKmReading(e.target.value)} />
                      <span className="drv-km-unit">km</span>
                    </div>
                  </div>

                  {/* Photo */}
                  <div className="field">
                    <label>Photo <span className="drv-required">*</span></label>
                    <UploadBox preview={imagePreview} fileRef={normalFileRef}
                      onChange={pickPhoto(setImageFile, setImagePreview)}
                      onDrop={dropPhoto(setImageFile, setImagePreview)}
                      onRemove={clearPhoto(setImageFile, setImagePreview, normalFileRef)} />
                  </div>

                  <button type="submit" className="btn drv-submit" disabled={saving || !vehicle}>
                    {saving ? 'Saving…' : 'Submit Reading'}
                  </button>
                </>
              )}
            </>
          )}

          {/* ── BACKUP MODE ──────────────────────────────────────── */}
          {mode === 'backup' && (
            <>
              {/* Section: Backup vehicle */}
              <p className="drv-section-label">Backup Vehicle</p>

              <div className="field">
                <label>Vehicle Number <span className="drv-required">*</span></label>
                <div className="drv-km-row">
                  <input className={`input${backupVehicleErr ? ' input-error' : ''}`}
                    type="text" placeholder="e.g. LHR-1234" autoCapitalize="characters"
                    value={backupVehicleNo} onChange={e => setBackupVehicleNo(e.target.value)} />
                  {backupLooking && <span className="drv-km-unit" style={{ minWidth: 16 }}>…</span>}
                  {backupVehicle && !backupLooking && <span className="drv-found-tick">✓</span>}
                </div>
                {backupVehicleNo.trim() && !backupLooking && !backupVehicle && (
                  <div className="drv-field-hint">Not in fleet — number will be noted</div>
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

              {/* Section: Original vehicle closing */}
              <div className="drv-section-divider">
                <span className="drv-section-divider-label">
                  Original Vehicle{vehicle ? ` · ${vehicle.vehicle_no}` : ''} · Closing KM
                </span>
              </div>

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

              <button type="submit" className="btn drv-submit"
                disabled={saving || !backupVehicleNo.trim() || !vehicle}>
                {saving ? 'Saving…' : 'Submit Both Readings'}
              </button>
            </>
          )}

        </form>

        {/* Backup button */}
        {mode === 'normal' && vehicle && (
          <button type="button" className="btn btn-ghost drv-backup-btn" onClick={enterBackup}>
            Using a backup vehicle today?
          </button>
        )}


      </main>
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
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onChange} />
      {preview && <button type="button" className="drv-remove-img" onClick={onRemove}>Remove</button>}
    </>
  )
}
