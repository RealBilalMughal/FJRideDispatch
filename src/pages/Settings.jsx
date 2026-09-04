import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { MapPinned, Pencil, Shield, Timer } from 'lucide-react'
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
// edits those three fields, no routing logic lives here. The city picker is
// always live (not tied to the global topbar city filter) - pick any city
// this admin page can see (`allowedCities`) and its current values show up;
// nothing is editable until "Edit" is pressed, same read-only-by-default
// pattern as Profile.
function AirportLocationsPanel() {
  const { allowedCities: cities, cityId: activeCityId, reloadCities } = useCity()
  // default selection = the active global city filter if one is set, else the first city
  const [cityId, setCityId] = useState(
    () => (activeCityId != null && cities.find((c) => c.id === activeCityId)?.id) || cities[0]?.id || '',
  )
  const city = useMemo(() => cities.find((c) => String(c.id) === String(cityId)), [cities, cityId])

  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [coordinates, setCoordinates] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const pickCity = (id) => {
    setCityId(id)
    setEditing(false)
    setErr('')
  }

  const startEdit = () => {
    setName(city?.airport_name ?? '')
    setCoordinates(fmtLatLng(city?.airport_lat, city?.airport_lng))
    setErr('')
    setEditing(true)
  }

  const cancel = () => {
    setErr('')
    setEditing(false)
  }

  const pin = useMemo(() => parseLatLng(coordinates), [coordinates])
  const viewPin = useMemo(() => parseLatLng(fmtLatLng(city?.airport_lat, city?.airport_lng)), [city])

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
    setEditing(false)
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
        {!editing && cities.length > 0 && (
          <button type="button" className="btn btn-ghost btn-square btn-sm" onClick={startEdit}>
            <Pencil size={13} /> Edit
          </button>
        )}
      </div>

      {cities.length === 0 ? (
        <p className="field-hint">No cities found.</p>
      ) : (
        <div className="set-form">
          <div className="field">
            <label htmlFor="ap-city">City</label>
            <select
              id="ap-city"
              className="select"
              value={cityId}
              onChange={(e) => pickCity(e.target.value)}
              disabled={editing}
            >
              {cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {editing ? (
            <form className="modal-form" onSubmit={submit}>
              {err && <div className="modal-error">{err}</div>}

              <div className="field">
                <label htmlFor="ap-name">Airport name</label>
                <input
                  id="ap-name"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. LHE Airport"
                  autoComplete="off"
                  autoFocus
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
                <button type="button" className="btn btn-ghost btn-square" onClick={cancel}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-square" disabled={busy}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          ) : (
            <div>
              <div className="view-row">
                <span className="view-label">Airport name</span>
                <span className="view-value">{city?.airport_name || '—'}</span>
              </div>
              <div className="view-row">
                <span className="view-label">Coordinates</span>
                <span className="view-value">{fmtLatLng(city?.airport_lat, city?.airport_lng) || '—'}</span>
              </div>
              {viewPin && <StopMap lat={viewPin.lat} lng={viewPin.lng} interactive={false} height={200} />}
            </div>
          )}
        </div>
      )}
    </>
  )
}

// ── Ride Buffer Time ─────────────────────────────────────────────────────
// Global settings for the two ride-time buffers, kept per city on
// cities.checkin_buffer_min / checkout_buffer_min:
//   Pickup Time = Check-in (Actual if set) - Check-in buffer - drive time
//   Drop Time   = Check-out (Actual if set) + Check-out buffer
// Same always-live city picker + read-only-until-Edit pattern as Airport
// Locations above.
function RideBufferTimePanel() {
  const { allowedCities: cities, cityId: activeCityId, reloadCities } = useCity()
  const [cityId, setCityId] = useState(
    () => (activeCityId != null && cities.find((c) => c.id === activeCityId)?.id) || cities[0]?.id || '',
  )
  const city = useMemo(() => cities.find((c) => String(c.id) === String(cityId)), [cities, cityId])

  const [editing, setEditing] = useState(false)
  const [checkin, setCheckin] = useState('')
  const [checkout, setCheckout] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const pickCity = (id) => {
    setCityId(id)
    setEditing(false)
    setErr('')
  }

  const startEdit = () => {
    setCheckin(city?.checkin_buffer_min ?? DEFAULT_CHECKIN_BUFFER_MIN)
    setCheckout(city?.checkout_buffer_min ?? DEFAULT_CHECKOUT_BUFFER_MIN)
    setErr('')
    setEditing(true)
  }

  const cancel = () => {
    setErr('')
    setEditing(false)
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
    setEditing(false)
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
        {!editing && cities.length > 0 && (
          <button type="button" className="btn btn-ghost btn-square btn-sm" onClick={startEdit}>
            <Pencil size={13} /> Edit
          </button>
        )}
      </div>

      {cities.length === 0 ? (
        <p className="field-hint">No cities found.</p>
      ) : (
        <div className="set-form">
          <div className="field">
            <label htmlFor="bf-city">City</label>
            <select
              id="bf-city"
              className="select"
              value={cityId}
              onChange={(e) => pickCity(e.target.value)}
              disabled={editing}
            >
              {cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {editing ? (
            <form className="modal-form" onSubmit={submit}>
              {err && <div className="modal-error">{err}</div>}

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
                    autoFocus
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
                <button type="button" className="btn btn-ghost btn-square" onClick={cancel}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-square" disabled={busy}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          ) : (
            <div>
              <div className="view-row">
                <span className="view-label">Check-in buffer</span>
                <span className="view-value">
                  {city?.checkin_buffer_min ?? DEFAULT_CHECKIN_BUFFER_MIN} min
                </span>
              </div>
              <div className="view-row">
                <span className="view-label">Check-out buffer</span>
                <span className="view-value">
                  {city?.checkout_buffer_min ?? DEFAULT_CHECKOUT_BUFFER_MIN} min
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
