import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { MapPinned, Save, Shield, Timer } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { useCity } from '../context/useCity'
import { DEFAULT_CHECKIN_BUFFER_MIN, DEFAULT_CHECKOUT_BUFFER_MIN } from '../lib/rideRoute'
import { parseLatLng, fmtLatLng } from '../lib/geo'
import StopMap from '../components/StopMap'
import '../components/modal.css'
import './Settings.css'

// Administration -> Settings: a left-panel shell (same "list + panel" layout
// as Role Access) over global, per-city configuration that only writes to
// `cities` - gated to super_admin to match that table's RLS (`cities_super`),
// same as the buttons this replaced on Crew/Rides. Not part of the granular
// page-permission catalogue for that reason (a role could be granted
// "view" here but every save would still fail server-side).
const SECTIONS = [
  { key: 'airports', label: 'Airport Locations', icon: MapPinned },
  { key: 'buffer', label: 'Ride Buffer Time', icon: Timer },
]

export default function Settings() {
  const { isSuperAdmin } = useAuth()
  const [section, setSection] = useState('airports')

  if (!isSuperAdmin) {
    return (
      <div className="page">
        <div className="card placeholder-card">
          <Shield size={28} color="var(--muted)" />
          <h2>No access</h2>
          <p>You don&rsquo;t have permission to view Settings.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Global ride-dispatch configuration</p>
        </div>
      </div>

      <div className="set-layout">
        <div className="set-list">
          <div className="set-list-head">Settings</div>
          {SECTIONS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              className={`set-list-item${section === key ? ' on' : ''}`}
              onClick={() => setSection(key)}
            >
              <Icon size={15} />
              <span className="set-name">{label}</span>
            </button>
          ))}
        </div>

        <div className="set-panel">
          {section === 'airports' ? <AirportLocationsPanel /> : <RideBufferTimePanel />}
        </div>
      </div>
    </div>
  )
}

// ── Airport Locations ────────────────────────────────────────────────────
// A settings UI over the existing cities.airport_name / airport_lat /
// airport_lng columns that Ride Dispatch routing already reads - this only
// edits those three fields, no routing logic lives here. `allowedCities` is
// already city-scoped for the caller (a Lahore-only user only ever sees
// Lahore); when the global city filter is on one city the picker locks to
// it, on "All" it's a picker over every city the caller can see.
function AirportLocationsPanel() {
  const { allowedCities: cities, cityId: activeCityId, reloadCities } = useCity()
  const locked = activeCityId != null
  const initialCity = useMemo(
    () => (locked && cities.find((c) => c.id === activeCityId)) || cities[0],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const [cityId, setCityId] = useState(initialCity?.id ?? '')
  const [name, setName] = useState(initialCity?.airport_name ?? '')
  const [coordinates, setCoordinates] = useState(fmtLatLng(initialCity?.airport_lat, initialCity?.airport_lng))
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const cityName = cities.find((c) => String(c.id) === String(cityId))?.name || ''

  const pickCity = (id) => {
    setCityId(id)
    const c = cities.find((x) => String(x.id) === String(id))
    setName(c?.airport_name ?? '')
    setCoordinates(fmtLatLng(c?.airport_lat, c?.airport_lng))
    setErr('')
  }

  const pin = useMemo(() => parseLatLng(coordinates), [coordinates])

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (!cityId) return setErr('Pick a city')
    if (!name.trim()) return setErr('Airport name is required')
    if (coordinates.trim() && !pin) return setErr('Coordinates must look like "31.9279, 74.9738"')
    setBusy(true)
    const { error } = await supabase
      .from('cities')
      .update({
        airport_name: name.trim(),
        airport_lat: pin ? pin.lat : null,
        airport_lng: pin ? pin.lng : null,
      })
      .eq('id', Number(cityId))
    setBusy(false)
    if (error) return setErr(error.message)
    toast.success('Airport updated')
    reloadCities?.()
  }

  return (
    <>
      <div className="set-panel-head">
        <div>
          <h3>Airport Locations</h3>
          <div className="sub">
            Rename each city&rsquo;s airport and set its location — Ride Dispatch always
            routes pickup/drop-off legs to and from this point.
          </div>
        </div>
      </div>

      {cities.length === 0 ? (
        <p className="field-hint">No cities found.</p>
      ) : (
        <form className="modal-form set-form" onSubmit={submit}>
          {err && <div className="modal-error">{err}</div>}

          <div className="field">
            <label htmlFor="ap-city">City</label>
            {locked ? (
              <input className="input" value={cityName} disabled />
            ) : (
              <select id="ap-city" className="select" value={cityId} onChange={(e) => pickCity(e.target.value)}>
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="field">
            <label htmlFor="ap-name">Airport name</label>
            <input
              id="ap-name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. LHE Airport"
              autoComplete="off"
            />
          </div>

          <div className="field">
            <label htmlFor="ap-coord">Airport coordinates</label>
            <input
              id="ap-coord"
              className="input"
              value={coordinates}
              onChange={(e) => setCoordinates(e.target.value)}
              placeholder="31.521600, 74.403600"
              autoComplete="off"
            />
            <span className="field-hint">
              Paste “latitude, longitude”. Drag the pin on the map to fine-tune.
            </span>
          </div>

          <StopMap
            lat={pin?.lat ?? null}
            lng={pin?.lng ?? null}
            onChange={({ lat, lng }) => setCoordinates(fmtLatLng(lat, lng))}
          />

          <div className="modal-actions">
            <button type="submit" className="btn btn-square" disabled={busy}>
              <Save size={13} /> {busy ? 'Saving…' : 'Save airport'}
            </button>
          </div>
        </form>
      )}
    </>
  )
}

// ── Ride Buffer Time ─────────────────────────────────────────────────────
// Global settings for the two ride-time buffers, kept per city on
// cities.checkin_buffer_min / checkout_buffer_min:
//   Pickup Time = Check-in (Actual if set) - Check-in buffer - drive time
//   Drop Time   = Check-out (Actual if set) + Check-out buffer
function RideBufferTimePanel() {
  const { allowedCities: cities, cityId: activeCityId, reloadCities } = useCity()
  const locked = activeCityId != null
  const initialCity = useMemo(
    () => (locked && cities.find((c) => c.id === activeCityId)) || cities[0],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const [cityId, setCityId] = useState(initialCity?.id ?? '')
  const [checkin, setCheckin] = useState(initialCity?.checkin_buffer_min ?? DEFAULT_CHECKIN_BUFFER_MIN)
  const [checkout, setCheckout] = useState(initialCity?.checkout_buffer_min ?? DEFAULT_CHECKOUT_BUFFER_MIN)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const cityName = cities.find((c) => String(c.id) === String(cityId))?.name || ''

  const pickCity = (id) => {
    setCityId(id)
    const c = cities.find((x) => String(x.id) === String(id))
    setCheckin(c?.checkin_buffer_min ?? DEFAULT_CHECKIN_BUFFER_MIN)
    setCheckout(c?.checkout_buffer_min ?? DEFAULT_CHECKOUT_BUFFER_MIN)
    setErr('')
  }

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (!cityId) return setErr('Pick a city')
    const ci = Number(checkin)
    const co = Number(checkout)
    if (!Number.isFinite(ci) || ci < 0) return setErr('Check-in buffer must be a number of minutes')
    if (!Number.isFinite(co) || co < 0) return setErr('Check-out buffer must be a number of minutes')
    setBusy(true)
    const { error } = await supabase
      .from('cities')
      .update({ checkin_buffer_min: Math.round(ci), checkout_buffer_min: Math.round(co) })
      .eq('id', Number(cityId))
    setBusy(false)
    if (error) return setErr(error.message)
    toast.success('Buffer times updated')
    reloadCities?.()
  }

  return (
    <>
      <div className="set-panel-head">
        <div>
          <h3>Ride Buffer Time</h3>
          <div className="sub">
            Pickup Time = Check-in − Check-in buffer − drive time. Drop Time = Check-out +
            Check-out buffer. Each city keeps its own buffer.
          </div>
        </div>
      </div>

      {cities.length === 0 ? (
        <p className="field-hint">No cities found.</p>
      ) : (
        <form className="modal-form set-form" onSubmit={submit}>
          {err && <div className="modal-error">{err}</div>}

          <div className="field">
            <label htmlFor="bf-city">City</label>
            {locked ? (
              <input className="input" value={cityName} disabled />
            ) : (
              <select id="bf-city" className="select" value={cityId} onChange={(e) => pickCity(e.target.value)}>
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="bf-cin">Check-in buffer (min)</label>
              <input
                id="bf-cin"
                type="number"
                min="0"
                className="input"
                value={checkin}
                onChange={(e) => setCheckin(e.target.value)}
              />
              <span className="field-hint">Pickup: at the airport this long before check-in</span>
            </div>
            <div className="field">
              <label htmlFor="bf-cout">Check-out buffer (min)</label>
              <input
                id="bf-cout"
                type="number"
                min="0"
                className="input"
                value={checkout}
                onChange={(e) => setCheckout(e.target.value)}
              />
              <span className="field-hint">Drop-off: added on top of check-out</span>
            </div>
          </div>

          <div className="modal-actions">
            <button type="submit" className="btn btn-square" disabled={busy}>
              <Save size={13} /> {busy ? 'Saving…' : 'Save buffer times'}
            </button>
          </div>
        </form>
      )}
    </>
  )
}
