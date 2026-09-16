import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { ArrowLeft, Camera, CheckCircle2, LogOut, MapPin, Sparkles } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { fmtDate } from '../lib/format'
import { pkToday, addDays } from '../lib/time'
import './DriverOdometer.css'

// reading_type values:
// daily        → normal end-of-day
// closing      → vehicle broke down, closing KM
// backup_start → backup vehicle opening reading
// backup_end   → backup vehicle closing reading
// return_start → original vehicle restarted, opening reading
// return_end   → original vehicle end-of-day after return

async function uploadPhoto(storageId, logDate, suffix, file) {
  const ext = file.name.split('.').pop()
  const path = `${storageId}/${logDate}_${suffix}_${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('odometer-images').upload(path, file, { upsert: true })
  if (error) return { url: null, error }
  const { data: { publicUrl } } = supabase.storage.from('odometer-images').getPublicUrl(path)
  return { url: publicUrl, error: null }
}

async function getPrevDayReading(vehicleId, beforeDate) {
  const { data } = await supabase
    .from('vehicle_odometer_logs').select('km_reading')
    .eq('vehicle_id', vehicleId).lt('log_date', beforeDate)
    .order('log_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1).maybeSingle()
  return data?.km_reading ?? null
}

async function getTodayReadingKm(vehicleId, logDate, recordedBy, readingType) {
  const { data } = await supabase
    .from('vehicle_odometer_logs').select('km_reading')
    .eq('vehicle_id', vehicleId).eq('log_date', logDate)
    .eq('recorded_by', recordedBy).eq('reading_type', readingType).maybeSingle()
  return data?.km_reading ?? null
}

function fetchGeoNow() {
  return new Promise((resolve) => {
    if (!navigator?.geolocation) { resolve(null); return }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 8000, maximumAge: 30000 },
    )
  })
}

function useGeo() {
  const [coords, setCoords] = useState(null)
  useEffect(() => {
    if (!navigator?.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { timeout: 10000, maximumAge: 60000 },
    )
  }, [])
  return coords
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = (e) => resolve(e.target.result.split(',')[1])
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

async function readOdometerFromImage(file) {
  try {
    const base64 = await fileToBase64(file)
    const { data, error } = await supabase.functions.invoke('read-odometer', {
      body: { image_base64: base64, mime_type: file.type || 'image/jpeg' },
    })
    if (error) return null
    return data?.km ?? null
  } catch {
    return null
  }
}

export default function DriverOdometer() {
  const { profile, signOut } = useAuth()
  const geoCoords = useGeo()

  const [vehicle, setVehicle]               = useState(null)
  const [vehicleLoading, setVehicleLoading] = useState(true)
  const [logDate, setLogDate]               = useState(pkToday())
  const [prevDay, setPrevDay]               = useState(false)

  // what's already saved in DB for today
  const [dbState, setDbState] = useState({
    hasDaily: false, hasClosing: false,
    hasBackupStart: false, hasBackupEnd: false,
    hasReturnStart: false, hasReturnEnd: false,
    backupVehicleId: null, backupVehicleNo: null,
  })

  // current UI mode — what form to show
  // 'idle' | 'breakdown' | 'backup_start' | 'backup_end' | 'return_start'
  const [uiMode, setUiMode] = useState('idle')

  // shared form fields (reset on mode change)
  const [kmReading, setKmReading]       = useState('')
  const [imageFile, setImageFile]       = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const fileRef = useRef(null)

  // AI odometer reading
  const [aiLoading, setAiLoading] = useState(false)
  const [aiRead, setAiRead]       = useState(null) // km value AI detected

  // backup vehicle lookup (backup_start mode)
  const [backupInput, setBackupInput]   = useState('')
  const [backupVehicle, setBackupVehicle] = useState(null)
  const [backupLooking, setBackupLooking] = useState(false)

  const [saving, setSaving] = useState(false)

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

  // ── night shift auto-detect ────────────────────────────────────
  useEffect(() => {
    const pkHour = new Date(Date.now() + 5 * 60 * 60 * 1000).getUTCHours()
    if (pkHour >= 23) setPrevDay(true)
  }, [])
  useEffect(() => { setLogDate(prevDay ? addDays(pkToday(), -1) : pkToday()) }, [prevDay])

  // ── load today's DB state ──────────────────────────────────────
  const loadState = async () => {
    if (!vehicle?.id || !profile?.id) return
    const { data } = await supabase
      .from('vehicle_odometer_logs')
      .select('id, vehicle_id, reading_type, vehicle:vehicles(vehicle_no)')
      .eq('log_date', logDate).eq('recorded_by', profile.id)
    const rows = data ?? []
    const hasFor = (type, vid) => rows.some(r => r.reading_type === type && r.vehicle_id === vid)
    const backupRow = rows.find(r => r.reading_type === 'backup_start')
    setDbState({
      hasDaily:       hasFor('daily',        vehicle.id),
      hasClosing:     hasFor('closing',      vehicle.id),
      hasBackupStart: !!backupRow,
      hasBackupEnd:   rows.some(r => r.reading_type === 'backup_end'),
      hasReturnStart: hasFor('return_start', vehicle.id),
      hasReturnEnd:   hasFor('return_end',   vehicle.id),
      backupVehicleId: backupRow?.vehicle_id ?? null,
      backupVehicleNo: backupRow?.vehicle?.vehicle_no ?? null,
    })
  }
  useEffect(() => { loadState() }, [vehicle?.id, logDate, profile?.id])

  // ── phase — derived from DB state ─────────────────────────────
  // done | return_active | backup_complete | on_backup | breakdown_done | normal
  const phase = useMemo(() => {
    if (dbState.hasDaily || dbState.hasReturnEnd)               return 'done'
    if (dbState.hasReturnStart)                                  return 'return_active'
    if (dbState.hasBackupEnd && !dbState.hasReturnStart)         return 'backup_complete'
    if (dbState.hasBackupStart && !dbState.hasBackupEnd)         return 'on_backup'
    if (dbState.hasClosing)                                      return 'breakdown_done'
    return 'normal'
  }, [dbState])

  // ── backup vehicle lookup ──────────────────────────────────────
  useEffect(() => {
    const t = backupInput.trim()
    if (!t) { setBackupVehicle(null); return }
    const timer = setTimeout(async () => {
      setBackupLooking(true)
      const { data } = await supabase.from('vehicles').select('id, vehicle_no, city_id')
        .ilike('vehicle_no', `%${t}%`).limit(1).maybeSingle()
      setBackupLooking(false)
      setBackupVehicle(data ?? null)
    }, 500)
    return () => clearTimeout(timer)
  }, [backupInput])

  // ── form helpers ───────────────────────────────────────────────
  const resetForm = () => {
    setKmReading(''); setImageFile(null); setImagePreview(null)
    setAiRead(null); setAiLoading(false)
    if (fileRef.current) fileRef.current.value = ''
  }
  const enterMode = (mode) => {
    resetForm()
    setBackupInput(''); setBackupVehicle(null)
    setUiMode(mode)
  }
  const backToIdle = () => { resetForm(); setUiMode('idle') }

  // ── photo pick + AI read ───────────────────────────────────────
  const handlePhotoFile = async (file) => {
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
    setAiRead(null)
    setAiLoading(true)
    const km = await readOdometerFromImage(file)
    setAiLoading(false)
    if (km != null) {
      setKmReading(String(Math.round(km)))
      setAiRead(km)
    }
  }

  // ── submit ─────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!vehicle?.id) { toast.error('No vehicle assigned'); return }
    setSaving(true)
    const geo = await fetchGeoNow() ?? geoCoords

    // ── backup_start: needs separate backup vehicle ──
    if (uiMode === 'backup_start') {
      if (!backupVehicle) { toast.error('Enter a valid fleet vehicle number'); setSaving(false); return }
      const km = parseFloat(kmReading)
      if (!Number.isFinite(km) || km < 0) { toast.error('Enter backup vehicle KM'); setSaving(false); return }
      if (!imageFile) { toast.error('Photo is required'); setSaving(false); return }

      const { url, error: upErr } = await uploadPhoto(backupVehicle.id, logDate, 'backup_start', imageFile)
      if (upErr) { toast.error('Photo upload failed'); setSaving(false); return }

      const { error } = await supabase.from('vehicle_odometer_logs').insert({
        vehicle_id: backupVehicle.id, log_date: logDate, city_id: backupVehicle.city_id,
        km_reading: km, daily_km: null, image_url: url,
        reading_type: 'backup_start',
        notes: `Backup start — original vehicle: ${vehicle.vehicle_no}`,
        recorded_by: profile.id, is_verified: false,
        submit_lat: geo?.lat ?? null, submit_lng: geo?.lng ?? null,
      })
      if (error) { toast.error('Failed to save'); setSaving(false); return }
      toast.success('Backup vehicle start recorded!')
      enterMode('idle'); loadState(); setSaving(false); return
    }

    // ── all other modes ──────────────────────────────
    const km = parseFloat(kmReading)
    if (!Number.isFinite(km) || km < 0) { toast.error('Enter a valid KM reading'); setSaving(false); return }
    if (!imageFile) { toast.error('Photo is required'); setSaving(false); return }

    let readingType, vehicleId, cityId, dailyKm, notes

    if (uiMode === 'breakdown') {
      readingType = 'closing'; vehicleId = vehicle.id; cityId = vehicle.city_id
      const prev = await getPrevDayReading(vehicle.id, logDate)
      dailyKm = prev != null ? +(km - prev).toFixed(1) : null
      notes = 'Closing KM — vehicle breakdown'

    } else if (uiMode === 'backup_end') {
      readingType = 'backup_end'; vehicleId = dbState.backupVehicleId
      const { data: bv } = await supabase.from('vehicles').select('city_id').eq('id', vehicleId).maybeSingle()
      cityId = bv?.city_id ?? vehicle.city_id
      const startKm = await getTodayReadingKm(vehicleId, logDate, profile.id, 'backup_start')
      dailyKm = startKm != null ? +(km - startKm).toFixed(1) : null
      notes = `Backup end — original vehicle: ${vehicle.vehicle_no}`

    } else if (uiMode === 'return_start') {
      readingType = 'return_start'; vehicleId = vehicle.id; cityId = vehicle.city_id
      dailyKm = null
      notes = 'Vehicle returned — restart reading'

    } else {
      // idle mode: daily or return_end
      vehicleId = vehicle.id; cityId = vehicle.city_id
      if (phase === 'return_active') {
        readingType = 'return_end'
        const startKm = await getTodayReadingKm(vehicle.id, logDate, profile.id, 'return_start')
        dailyKm = startKm != null ? +(km - startKm).toFixed(1) : null
        notes = 'End-of-day reading after vehicle return'
      } else {
        readingType = 'daily'
        const prev = await getPrevDayReading(vehicle.id, logDate)
        dailyKm = prev != null ? +(km - prev).toFixed(1) : null
        notes = null
      }
    }

    const { url: imgUrl, error: upErr } = await uploadPhoto(vehicleId, logDate, readingType, imageFile)
    if (upErr) { toast.error('Photo upload failed'); setSaving(false); return }

    const { error } = await supabase.from('vehicle_odometer_logs').insert({
      vehicle_id: vehicleId, log_date: logDate, city_id: cityId,
      km_reading: km, daily_km: dailyKm, image_url: imgUrl,
      reading_type: readingType, notes,
      recorded_by: profile.id, is_verified: false,
      submit_lat: geo?.lat ?? null, submit_lng: geo?.lng ?? null,
    })
    if (error) { toast.error('Failed to save reading'); setSaving(false); return }

    toast.success('Reading saved!')
    resetForm(); setUiMode('idle'); loadState()
    setSaving(false)
  }

  // ── time display ───────────────────────────────────────────────
  const pkNow  = new Date(Date.now() + 5 * 60 * 60 * 1000)
  const timeStr = pkNow.toISOString().slice(11, 16)
  const fmtHHMM = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number)
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
  }

  const isFormMode = uiMode !== 'idle' || phase === 'normal' || phase === 'return_active'

  const formTitle = () => {
    if (uiMode === 'breakdown')    return 'Breakdown — Closing KM'
    if (uiMode === 'backup_start') return 'Backup Vehicle — Opening Reading'
    if (uiMode === 'backup_end')   return `Backup Vehicle${dbState.backupVehicleNo ? ` · ${dbState.backupVehicleNo}` : ''} — Closing Reading`
    if (uiMode === 'return_start') return 'Vehicle Returned — Restart Reading'
    if (phase === 'return_active') return 'End-of-Day Reading'
    return null // normal phase — show vehicle badge instead
  }

  const submitLabel = () => {
    if (saving) return 'Saving…'
    if (uiMode === 'breakdown')    return 'Save Closing Reading'
    if (uiMode === 'backup_start') return 'Record Backup Start'
    if (uiMode === 'backup_end')   return 'Record Backup Return'
    if (uiMode === 'return_start') return 'Record Restart Reading'
    if (phase === 'return_active') return 'Submit End-of-Day Reading'
    return 'Submit Daily Reading'
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

        {/* date bar */}
        <div className="drv-datebar">
          <span className="drv-date-val">{fmtDate(logDate)} · {fmtHHMM(timeStr)}</span>
          <label className="drv-night-check">
            <input type="checkbox" checked={prevDay} onChange={e => setPrevDay(e.target.checked)} />
            Night shift
          </label>
        </div>

        {/* back button */}
        {uiMode !== 'idle' && (
          <button type="button" className="drv-back-btn" onClick={backToIdle}>
            <ArrowLeft size={14} /> Back
          </button>
        )}

        {/* ── FORM (when submitting a reading) ──────────────────── */}
        {isFormMode && (
          <form className="drv-form" onSubmit={handleSubmit}>

            {/* header: title or vehicle badge */}
            {formTitle() ? (
              <p className="drv-section-label drv-section-sep">{formTitle()}</p>
            ) : (
              <div className="drv-vehicle-badge">
                {vehicleLoading
                  ? <span className="drv-vbadge-no drv-vehicle-loading">Loading…</span>
                  : vehicle
                    ? <><span className="drv-vbadge-no">{vehicle.vehicle_no}</span>
                        <span className="drv-vbadge-label">Your assigned vehicle</span></>
                    : <span className="drv-no-vehicle">No vehicle assigned — contact supervisor</span>}
              </div>
            )}

            {/* backup vehicle input (backup_start mode) */}
            {uiMode === 'backup_start' && (
              <div className="field">
                <label>Backup Vehicle Number <span className="drv-required">*</span></label>
                <div className="drv-km-row">
                  <input className="input" type="text" placeholder="e.g. ALY-851"
                    autoCapitalize="characters"
                    value={backupInput} onChange={e => setBackupInput(e.target.value)} />
                  {backupLooking && <span className="drv-km-unit">…</span>}
                  {!backupLooking && backupVehicle && <span className="drv-found-tick">✓</span>}
                </div>
                {backupInput.trim() && !backupLooking && !backupVehicle && (
                  <div className="drv-field-err">Vehicle not found in fleet</div>
                )}
              </div>
            )}

            {/* KM field */}
            <div className="drv-km-field">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <label className="drv-km-label" style={{ margin: 0 }}>KM Reading <span className="drv-required">*</span></label>
                {aiLoading && (
                  <span className="drv-ai-tag drv-ai-loading">
                    <Sparkles size={11} /> Reading…
                  </span>
                )}
                {!aiLoading && aiRead != null && (
                  <span className="drv-ai-tag">
                    <Sparkles size={11} /> AI read
                  </span>
                )}
              </div>
              <div className="drv-km-row">
                <input className="input drv-km-input" type="number" min="0" step="1"
                  placeholder="0" value={kmReading}
                  onChange={e => { setKmReading(e.target.value); setAiRead(null) }} />
                <span className="drv-km-unit">km</span>
              </div>
              {aiRead != null && !aiLoading && (
                <div className="drv-field-hint">Auto-filled from photo — edit if incorrect</div>
              )}
            </div>

            {/* photo upload */}
            <div className="field">
              <label>Photo <span className="drv-required">*</span></label>
              <div className={`drv-upload${imagePreview ? ' has-image' : ''}`}
                onClick={() => fileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handlePhotoFile(f) }}>
                {imagePreview
                  ? <img src={imagePreview} alt="Preview" className="drv-upload-preview" />
                  : <div className="drv-upload-placeholder"><Camera size={18} /><span>Tap to capture</span></div>}
              </div>
              <input ref={fileRef} type="file" capture="environment" hidden
                onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoFile(f) }} />
              {imagePreview && (
                <button type="button" className="drv-remove-img" onClick={() => {
                  setImageFile(null); setImagePreview(null); setAiRead(null)
                  if (fileRef.current) fileRef.current.value = ''
                }}>Remove</button>
              )}
            </div>

            <GeoBar coords={geoCoords} />

            <button type="submit" className="btn drv-submit"
              disabled={saving || !vehicle || (uiMode === 'backup_start' && !backupVehicle)}>
              {submitLabel()}
            </button>
          </form>
        )}

        {/* ── STATUS + BUTTONS (idle, non-form phases) ──────────── */}
        {uiMode === 'idle' && !isFormMode && (
          <div className="drv-form">

            {phase === 'done' && (
              <div className="drv-done-notice">
                <CheckCircle2 size={16} /> All readings recorded for {fmtDate(logDate)}
              </div>
            )}

            {phase === 'breakdown_done' && (
              <>
                <div className="drv-done-notice">
                  <CheckCircle2 size={16} />
                  Closing recorded — {vehicle?.vehicle_no ?? ''} on standby
                </div>
                <div className="drv-bottom-actions">
                  <button type="button" className="btn drv-backup-btn" onClick={() => enterMode('backup_start')}>
                    Using a backup vehicle
                  </button>
                  <button type="button" className="btn btn-ghost drv-backup-btn" onClick={() => enterMode('return_start')}>
                    My vehicle is back (no backup)
                  </button>
                </div>
              </>
            )}

            {phase === 'on_backup' && (
              <>
                <div className="drv-done-notice drv-notice-amber">
                  On backup vehicle{dbState.backupVehicleNo ? `: ${dbState.backupVehicleNo}` : ''}
                </div>
                <div className="drv-bottom-actions">
                  <button type="button" className="btn drv-backup-btn" onClick={() => enterMode('backup_end')}>
                    Backup vehicle returned
                  </button>
                </div>
              </>
            )}

            {phase === 'backup_complete' && (
              <>
                <div className="drv-done-notice">
                  <CheckCircle2 size={16} /> Backup done. Waiting for original vehicle.
                </div>
                <div className="drv-bottom-actions">
                  <button type="button" className="btn drv-backup-btn" onClick={() => enterMode('return_start')}>
                    My original vehicle is back
                  </button>
                </div>
              </>
            )}

          </div>
        )}

        {/* ── BREAKDOWN BUTTON (only on normal phase, idle) ─────── */}
        {uiMode === 'idle' && phase === 'normal' && vehicle && (
          <div className="drv-bottom-actions">
            <button type="button" className="btn btn-ghost drv-backup-btn" onClick={() => enterMode('breakdown')}>
              Vehicle broke down today
            </button>
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
