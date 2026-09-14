import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Camera, CheckCircle2, LogOut, Upload } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { fmtDate } from '../lib/format'
import { pkToday, addDays } from '../lib/time'
import './DriverOdometer.css'

export default function DriverOdometer() {
  const { profile, signOut } = useAuth()

  // vehicle list (all active vehicles in driver's allowed cities)
  const [vehicles, setVehicles] = useState([])
  const [vehicleId, setVehicleId] = useState('')

  // form
  const [logDate, setLogDate] = useState(pkToday())
  const [prevDay, setPrevDay] = useState(false)
  const [kmReading, setKmReading] = useState('')
  const [notes, setNotes] = useState('')
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [saving, setSaving] = useState(false)

  // recent readings
  const [recent, setRecent] = useState([])
  const fileRef = useRef(null)

  useEffect(() => {
    supabase
      .from('vehicles')
      .select('id, vehicle_no, city_id')
      .eq('is_active', true)
      .order('vehicle_no')
      .then(({ data }) => {
        const v = data ?? []
        setVehicles(v)
        if (v.length === 1) setVehicleId(v[0].id)
      })
  }, [])

  // sync prevDay → logDate
  useEffect(() => {
    const today = pkToday()
    setLogDate(prevDay ? addDays(today, -1) : today)
  }, [prevDay])

  // auto-suggest "previous day" after 11 PM
  useEffect(() => {
    const pkHour = new Date(Date.now() + 5 * 60 * 60 * 1000).getUTCHours()
    if (pkHour >= 23) setPrevDay(true)
  }, [])

  // fetch recent readings when vehicle changes
  useEffect(() => {
    if (!vehicleId) { setRecent([]); return }
    const since = addDays(pkToday(), -7)
    supabase
      .from('vehicle_odometer_logs')
      .select('id, log_date, km_reading, daily_km, is_verified')
      .eq('vehicle_id', vehicleId)
      .gte('log_date', since)
      .order('log_date', { ascending: false })
      .then(({ data }) => setRecent(data ?? []))
  }, [vehicleId])

  const onFileChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }

  const onDrop = (e) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const km = parseFloat(kmReading)
    if (!vehicleId) { toast.error('Select a vehicle'); return }
    if (!Number.isFinite(km) || km < 0) { toast.error('Enter a valid KM reading'); return }

    setSaving(true)

    // find city_id for selected vehicle
    const vehicle = vehicles.find(v => v.id === vehicleId)
    const cityId = vehicle?.city_id

    // check if reading already exists for this vehicle+date
    const { data: existing } = await supabase
      .from('vehicle_odometer_logs')
      .select('id')
      .eq('vehicle_id', vehicleId)
      .eq('log_date', logDate)
      .maybeSingle()

    if (existing) {
      toast.error(`A reading for ${fmtDate(logDate)} already exists for this vehicle.`)
      setSaving(false)
      return
    }

    // upload image if any
    let imageUrl = null
    if (imageFile) {
      const ext = imageFile.name.split('.').pop()
      const path = `${vehicleId}/${logDate}_${Date.now()}.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from('odometer-images')
        .upload(path, imageFile, { upsert: true })
      if (uploadErr) {
        toast.error('Image upload failed — saving reading without photo')
      } else {
        const { data: { publicUrl } } = supabase.storage
          .from('odometer-images')
          .getPublicUrl(path)
        imageUrl = publicUrl
      }
    }

    // compute daily_km: today's reading - previous reading
    const { data: prev } = await supabase
      .from('vehicle_odometer_logs')
      .select('km_reading, log_date')
      .eq('vehicle_id', vehicleId)
      .lt('log_date', logDate)
      .order('log_date', { ascending: false })
      .limit(1)
      .maybeSingle()

    const dailyKm = prev ? +(km - prev.km_reading).toFixed(1) : null

    const { error } = await supabase
      .from('vehicle_odometer_logs')
      .insert({
        vehicle_id: vehicleId,
        log_date: logDate,
        city_id: cityId,
        km_reading: km,
        daily_km: dailyKm,
        image_url: imageUrl,
        notes: notes.trim() || null,
        recorded_by: profile.id,
        is_verified: false,
      })

    setSaving(false)

    if (error) {
      toast.error('Failed to save reading')
      return
    }

    toast.success('Reading saved!')
    setKmReading('')
    setNotes('')
    setImageFile(null)
    setImagePreview(null)
    if (fileRef.current) fileRef.current.value = ''

    // refresh recent
    const since = addDays(pkToday(), -7)
    const { data: updated } = await supabase
      .from('vehicle_odometer_logs')
      .select('id, log_date, km_reading, daily_km, is_verified')
      .eq('vehicle_id', vehicleId)
      .gte('log_date', since)
      .order('log_date', { ascending: false })
    setRecent(updated ?? [])
  }

  // today already recorded?
  const todayDone = recent.some(r => r.log_date === logDate)

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
          {/* Vehicle */}
          <div className="field">
            <label>Vehicle</label>
            <select
              className="input"
              value={vehicleId}
              onChange={e => setVehicleId(e.target.value)}
              required
            >
              <option value="">Select vehicle…</option>
              {vehicles.map(v => (
                <option key={v.id} value={v.id}>{v.vehicle_no}</option>
              ))}
            </select>
          </div>

          {/* Date */}
          <div className="field">
            <label>Date</label>
            <div className="drv-date-row">
              <div className="input drv-date-display">{fmtDate(logDate)}</div>
              <label className="check-line drv-prev-check">
                <input
                  type="checkbox"
                  checked={prevDay}
                  onChange={e => setPrevDay(e.target.checked)}
                />
                Previous day (night shift)
              </label>
            </div>
            {todayDone && (
              <div className="drv-already">
                <CheckCircle2 size={13} /> Reading already recorded for {fmtDate(logDate)}
              </div>
            )}
          </div>

          {/* KM Reading */}
          <div className="field">
            <label>KM Reading</label>
            <div className="drv-km-row">
              <input
                className="input"
                type="number"
                min="0"
                step="0.1"
                placeholder="e.g. 45230.5"
                value={kmReading}
                onChange={e => setKmReading(e.target.value)}
                required
              />
              <span className="drv-km-unit">km</span>
            </div>
          </div>

          {/* Photo upload */}
          <div className="field">
            <label>Photo <span className="field-hint">(optional but recommended)</span></label>
            <div
              className={`drv-upload${imagePreview ? ' has-image' : ''}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={onDrop}
            >
              {imagePreview ? (
                <img src={imagePreview} alt="Preview" className="drv-upload-preview" />
              ) : (
                <div className="drv-upload-placeholder">
                  <Camera size={28} />
                  <span>Tap to take photo or upload</span>
                </div>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={onFileChange}
            />
            {imagePreview && (
              <button
                type="button"
                className="drv-remove-img"
                onClick={() => { setImageFile(null); setImagePreview(null); if (fileRef.current) fileRef.current.value = '' }}
              >
                Remove photo
              </button>
            )}
          </div>

          {/* Notes */}
          <div className="field">
            <label>Notes <span className="field-hint">(optional)</span></label>
            <textarea
              className="input"
              rows={2}
              placeholder="Backup vehicle, issue note, etc."
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>

          <button type="submit" className="btn drv-submit" disabled={saving || todayDone}>
            {saving ? 'Saving…' : todayDone ? `Already recorded for ${fmtDate(logDate)}` : 'Submit Reading'}
          </button>
        </form>

        {/* Recent readings */}
        {recent.length > 0 && (
          <div className="drv-recent">
            <h2>Last 7 Days — {vehicles.find(v => v.id === vehicleId)?.vehicle_no}</h2>
            <table className="drv-recent-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>KM Reading</th>
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
