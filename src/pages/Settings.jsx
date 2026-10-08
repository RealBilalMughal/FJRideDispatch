import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Building2, MapPinned, Pencil, Plus, Ruler, Satellite, Shield, Timer, Trash2, UserCheck, LayoutList } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { useCity } from '../context/useCity'
import {
  DEFAULT_CHECKIN_BUFFER_MIN,
  DEFAULT_CHECKOUT_BUFFER_MIN,
  DEFAULT_CREW_WAIT_BUFFER_MIN,
  DEFAULT_DEADHEAD_BUFFER_MIN,
  DEFAULT_RETURN_LEG_BUFFER_MIN,
} from '../lib/rideRoute'
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
  { key: 'blockkm', label: 'Block KM Buffer', icon: Ruler },
  { key: 'tracker', label: 'Live Tracker', icon: Satellite },
  { key: 'rideplan', label: 'Ride Plan', icon: LayoutList },
  { key: 'buscaroinfo', label: 'BusCaro Info', icon: Building2 },
  { key: 'accountmanager', label: 'Account Manager', icon: UserCheck },
  // 'notify' hidden until a real WhatsApp/SMS provider is set up (see
  // Rides.jsx's NOTIFY_ENABLED) - NotificationsPanel/cities.notify_* are
  // untouched, just not reachable from this list right now.
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
          {section === 'airports' ? (
            <AirportLocationsPanel />
          ) : section === 'buffer' ? (
            <RideBufferTimePanel />
          ) : section === 'blockkm' ? (
            <BlockKmBufferPanel />
          ) : section === 'tracker' ? (
            <LiveTrackerPanel />
          ) : section === 'rideplan' ? (
            <RidePlanSettingsPanel />
          ) : section === 'buscaroinfo' ? (
            <BusCaroInfoPanel />
          ) : section === 'accountmanager' ? (
            <AccountManagerPanel />
          ) : (
            <NotificationsPanel />
          )}
        </div>
      </div>
    </div>
  )
}

// ── Airport Locations ────────────────────────────────────────────────────
// A settings UI over the existing cities.airport_name / airport_lat /
// airport_lng columns that Ride Dispatch routing already reads - this only
// edits those three fields, no routing logic lives here. The City field
// mirrors the global topbar filter: one city selected there -> locked to
// just that city here; "All" -> a live picker over every city this admin
// page can see. Nothing is editable until "Edit" is pressed, same
// read-only-by-default pattern as Profile.
function AirportLocationsPanel() {
  const { allowedCities: cities, cityId: activeCityId, reloadCities } = useCity()
  const locked = activeCityId != null
  const [cityId, setCityId] = useState(
    () => (locked && cities.find((c) => c.id === activeCityId)?.id) || cities[0]?.id || '',
  )
  const city = useMemo(() => cities.find((c) => String(c.id) === String(cityId)), [cities, cityId])
  const cityName = city?.name || ''

  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [coordinates, setCoordinates] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  // the topbar filter can change while this page stays mounted - follow it
  useEffect(() => {
    if (locked && cities.some((c) => c.id === activeCityId)) {
      setCityId(activeCityId)
      setEditing(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, activeCityId])

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
            {locked ? (
              <input className="input" value={cityName} disabled />
            ) : (
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
            )}
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
// Global settings for the three ride-time buffers, kept per city on
// cities.checkin_buffer_min / checkout_buffer_min / return_leg_buffer_min:
//   Pickup Time      = Check-in (Actual if set) - Check-in buffer - drive time
//   Drop Time        = Check-out (Actual if set) + Check-out buffer
//   Return Leg Ride Time = the dropoff ride's ETA (arrival at the crew stop)
//                          + Return Leg buffer
// Same City-field-mirrors-the-global-filter + read-only-until-Edit pattern
// as Airport Locations above.
function RideBufferTimePanel() {
  const { allowedCities: cities, cityId: activeCityId, reloadCities } = useCity()
  const locked = activeCityId != null
  const [cityId, setCityId] = useState(
    () => (locked && cities.find((c) => c.id === activeCityId)?.id) || cities[0]?.id || '',
  )
  const city = useMemo(() => cities.find((c) => String(c.id) === String(cityId)), [cities, cityId])
  const cityName = city?.name || ''

  const [editing, setEditing] = useState(false)
  const [checkin, setCheckin] = useState('')
  const [checkout, setCheckout] = useState('')
  const [returnLeg, setReturnLeg] = useState('')
  const [deadhead, setDeadhead] = useState('')
  const [crewWait, setCrewWait] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  // the topbar filter can change while this page stays mounted - follow it
  useEffect(() => {
    if (locked && cities.some((c) => c.id === activeCityId)) {
      setCityId(activeCityId)
      setEditing(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, activeCityId])

  const pickCity = (id) => {
    setCityId(id)
    setEditing(false)
    setErr('')
  }

  const startEdit = () => {
    setCheckin(city?.checkin_buffer_min ?? DEFAULT_CHECKIN_BUFFER_MIN)
    setCheckout(city?.checkout_buffer_min ?? DEFAULT_CHECKOUT_BUFFER_MIN)
    setReturnLeg(city?.return_leg_buffer_min ?? DEFAULT_RETURN_LEG_BUFFER_MIN)
    setDeadhead(city?.deadhead_buffer_min ?? DEFAULT_DEADHEAD_BUFFER_MIN)
    setCrewWait(city?.crew_wait_buffer_min ?? DEFAULT_CREW_WAIT_BUFFER_MIN)
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
    const rl = Number(returnLeg)
    const dh = Number(deadhead)
    const cw = Number(crewWait)
    if (!Number.isFinite(ci) || ci < 0) return setErr('Check-in buffer must be a number of minutes')
    if (!Number.isFinite(co) || co < 0) return setErr('Check-out buffer must be a number of minutes')
    if (!Number.isFinite(rl) || rl < 0) return setErr('Return Leg buffer must be a number of minutes')
    if (!Number.isFinite(dh) || dh < 0) return setErr('Deadhead buffer must be a number of minutes')
    if (!Number.isFinite(cw) || cw < 0) return setErr('Crew wait buffer must be a number of minutes')
    setBusy(true)
    const { error } = await supabase
      .from('cities')
      .update({
        checkin_buffer_min: Math.round(ci),
        checkout_buffer_min: Math.round(co),
        return_leg_buffer_min: Math.round(rl),
        deadhead_buffer_min: Math.round(dh),
        crew_wait_buffer_min: Math.round(cw),
      })
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
            Pickup Time = Check-in − Check-in buffer − trip time. Drop Time = Check-out +
            Check-out buffer. Return Leg / Deadhead Ride Time = drop-off arrival + that
            buffer. Crew wait buffer adds crew × this many minutes to a multi-crew
            pickup / dropoff. Each city keeps its own buffers.
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
            {locked ? (
              <input className="input" value={cityName} disabled />
            ) : (
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
            )}
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

              <div className="field-row">
                <div className="field">
                  <label htmlFor="bf-rl">Return Leg buffer (min)</label>
                  <input
                    id="bf-rl"
                    type="number"
                    min="0"
                    className="input"
                    value={returnLeg}
                    onChange={(e) => setReturnLeg(e.target.value)}
                  />
                  <span className="field-hint">Added on top of the dropoff ride&rsquo;s arrival</span>
                </div>
                <div className="field">
                  <label htmlFor="bf-dh">Deadhead buffer (min)</label>
                  <input
                    id="bf-dh"
                    type="number"
                    min="0"
                    className="input"
                    value={deadhead}
                    onChange={(e) => setDeadhead(e.target.value)}
                  />
                  <span className="field-hint">Added on top of the dropoff ride&rsquo;s arrival</span>
                </div>
              </div>

              <div className="field-row">
                <div className="field">
                  <label htmlFor="bf-cw">Crew wait buffer (min)</label>
                  <input
                    id="bf-cw"
                    type="number"
                    min="0"
                    className="input"
                    value={crewWait}
                    onChange={(e) => setCrewWait(e.target.value)}
                  />
                  <span className="field-hint">
                    Multi-crew pickup / dropoff: wait at every crew stop &mdash; adds
                    crew &times; this to the ride time
                  </span>
                </div>
                <div className="field" />
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
              <div className="view-row">
                <span className="view-label">Return Leg buffer</span>
                <span className="view-value">
                  {city?.return_leg_buffer_min ?? DEFAULT_RETURN_LEG_BUFFER_MIN} min
                </span>
              </div>
              <div className="view-row">
                <span className="view-label">Deadhead buffer</span>
                <span className="view-value">
                  {city?.deadhead_buffer_min ?? DEFAULT_DEADHEAD_BUFFER_MIN} min
                </span>
              </div>
              <div className="view-row">
                <span className="view-label">Crew wait buffer</span>
                <span className="view-value">
                  {city?.crew_wait_buffer_min ?? DEFAULT_CREW_WAIT_BUFFER_MIN} min
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}

// ── Block KM Buffer ──────────────────────────────────────────────────────
// A flat extra distance added to Pickup / Drop Off block rides
// (cities.pickup_extra_km / dropoff_extra_km) - folds into rides.distance_km
// at save (see blockExtraKm() in rideRoute.js). Same
// City-field-mirrors-the-global-filter + read-only-until-Edit shell as the
// panels above.
function BlockKmBufferPanel() {
  const { allowedCities: cities, cityId: activeCityId, reloadCities } = useCity()
  const locked = activeCityId != null
  const [cityId, setCityId] = useState(
    () => (locked && cities.find((c) => c.id === activeCityId)?.id) || cities[0]?.id || '',
  )
  const city = useMemo(() => cities.find((c) => String(c.id) === String(cityId)), [cities, cityId])
  const cityName = city?.name || ''

  const [editing, setEditing] = useState(false)
  const [pickupKm, setPickupKm] = useState('')
  const [dropoffKm, setDropoffKm] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (locked && cities.some((c) => c.id === activeCityId)) {
      setCityId(activeCityId)
      setEditing(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, activeCityId])

  const pickCity = (id) => {
    setCityId(id)
    setEditing(false)
    setErr('')
  }

  const startEdit = () => {
    setPickupKm(city?.pickup_extra_km ?? 0)
    setDropoffKm(city?.dropoff_extra_km ?? 0)
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
    const pk = Number(pickupKm)
    const dk = Number(dropoffKm)
    if (!Number.isFinite(pk) || pk < 0) return setErr('Pickup KM must be a positive number')
    if (!Number.isFinite(dk) || dk < 0) return setErr('Drop Off KM must be a positive number')
    setBusy(true)
    const { error } = await supabase
      .from('cities')
      .update({
        pickup_extra_km: Math.round(pk * 100) / 100,
        dropoff_extra_km: Math.round(dk * 100) / 100,
      })
      .eq('id', Number(cityId))
    setBusy(false)
    if (error) return setErr(error.message)
    toast.success('Block KM buffer updated')
    setEditing(false)
    reloadCities?.()
  }

  return (
    <>
      <div className="set-panel-head">
        <div>
          <h3>Block KM Buffer</h3>
          <div className="sub">
            A flat distance added to every <b>Pickup</b> / <b>Drop Off</b> ride&rsquo;s KM
            (on top of the road route). Shows in the KM column, CSV export and the ride
            View&rsquo;s Distance breakdown. Each city keeps its own values.
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
            <label htmlFor="bk-city">City</label>
            {locked ? (
              <input className="input" value={cityName} disabled />
            ) : (
              <select
                id="bk-city"
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
            )}
          </div>

          {editing ? (
            <form className="modal-form" onSubmit={submit}>
              {err && <div className="modal-error">{err}</div>}
              <div className="field-row">
                <div className="field">
                  <label htmlFor="bk-pk">Pickup KM</label>
                  <input
                    id="bk-pk"
                    type="number"
                    min="0"
                    step="0.1"
                    className="input"
                    value={pickupKm}
                    onChange={(e) => setPickupKm(e.target.value)}
                    autoFocus
                  />
                  <span className="field-hint">Added to every Pickup ride&rsquo;s distance</span>
                </div>
                <div className="field">
                  <label htmlFor="bk-dk">Drop Off KM</label>
                  <input
                    id="bk-dk"
                    type="number"
                    min="0"
                    step="0.1"
                    className="input"
                    value={dropoffKm}
                    onChange={(e) => setDropoffKm(e.target.value)}
                  />
                  <span className="field-hint">Added to every Drop Off ride&rsquo;s distance</span>
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
                <span className="view-label">Pickup KM</span>
                <span className="view-value">{Number(city?.pickup_extra_km ?? 0)} km</span>
              </div>
              <div className="view-row">
                <span className="view-label">Drop Off KM</span>
                <span className="view-value">{Number(city?.dropoff_extra_km ?? 0)} km</span>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}

// ── Live Tracker ─────────────────────────────────────────────────────────
// Each city keeps its own GPS tracker sharing link (e.g. AI Track) on
// cities.tracker_url - same City-field-mirrors-the-global-filter +
// read-only-until-Edit pattern as Airport Locations / Ride Buffer Time
// above. The Vehicle Board's Tracker tab embeds the active city's link, or
// every city's link (that has one) when the topbar filter is on All.
function LiveTrackerPanel() {
  const { allowedCities: cities, cityId: activeCityId, reloadCities } = useCity()
  const locked = activeCityId != null
  const [cityId, setCityId] = useState(
    () => (locked && cities.find((c) => c.id === activeCityId)?.id) || cities[0]?.id || '',
  )
  const city = useMemo(() => cities.find((c) => String(c.id) === String(cityId)), [cities, cityId])
  const cityName = city?.name || ''

  const [editing, setEditing] = useState(false)
  const [url, setUrl] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  // the topbar filter can change while this page stays mounted - follow it
  useEffect(() => {
    if (locked && cities.some((c) => c.id === activeCityId)) {
      setCityId(activeCityId)
      setEditing(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, activeCityId])

  const pickCity = (id) => {
    setCityId(id)
    setEditing(false)
    setErr('')
  }

  const startEdit = () => {
    setUrl(city?.tracker_url ?? '')
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
    const trimmed = url.trim()
    if (trimmed && !/^https:\/\//i.test(trimmed)) return setErr('Must be a full https:// link')
    setBusy(true)
    const { error } = await supabase
      .from('cities')
      .update({ tracker_url: trimmed || null })
      .eq('id', Number(cityId))
    setBusy(false)
    if (error) return setErr(error.message)
    toast.success('Tracker link updated')
    setEditing(false)
    reloadCities?.()
  }

  return (
    <>
      <div className="set-panel-head">
        <div>
          <h3>Live Tracker</h3>
          <div className="sub">
            Each city&rsquo;s own GPS tracker sharing link — embedded on the Vehicle
            Board&rsquo;s Tracker tab for that city (or every city with a link set, when
            viewing All). Leave a city blank to skip it.
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
            <label htmlFor="tr-city">City</label>
            {locked ? (
              <input className="input" value={cityName} disabled />
            ) : (
              <select
                id="tr-city"
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
            )}
          </div>

          {editing ? (
            <form className="modal-form" onSubmit={submit}>
              {err && <div className="modal-error">{err}</div>}
              <div className="field">
                <label htmlFor="tr-url">Tracker sharing link</label>
                <input
                  id="tr-url"
                  className="input"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://login.aitrack.pk/sharing/..."
                  autoComplete="off"
                  autoFocus
                />
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
            <div className="view-row">
              <span className="view-label">Tracker link</span>
              <span className="view-value">{city?.tracker_url || '—'}</span>
            </div>
          )}
        </div>
      )}
    </>
  )
}

// ── Notifications ────────────────────────────────────────────────────────
// Per-city webhook URL + message template. Pressing "Notify" on a ride calls
// the `notify-ride` Edge Function, which renders the template and POSTs a JSON
// payload (ride + recipient phones + message) to this URL. The receiver
// (Zapier / Make / a gateway script / WhatsApp Business API) does the sending.
const NOTIFY_PLACEHOLDER = [
  'FJ Ride {{ref}} — {{block}} on {{date}}',
  'Flight {{flight}} · {{time_label}} {{time}}',
  '{{origin}} → {{dest}}',
  'Vehicle {{vehicle}} · Driver {{driver}}',
].join('\n')

function NotificationsPanel() {
  const { allowedCities: cities, cityId: activeCityId, reloadCities } = useCity()
  const locked = activeCityId != null
  const [cityId, setCityId] = useState(
    () => (locked && cities.find((c) => c.id === activeCityId)?.id) || cities[0]?.id || '',
  )
  const city = useMemo(() => cities.find((c) => String(c.id) === String(cityId)), [cities, cityId])
  const cityName = city?.name || ''

  const [editing, setEditing] = useState(false)
  const [url, setUrl] = useState('')
  const [tpl, setTpl] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (locked && cities.some((c) => c.id === activeCityId)) {
      setCityId(activeCityId)
      setEditing(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, activeCityId])

  const pickCity = (id) => {
    setCityId(id)
    setEditing(false)
    setErr('')
  }
  const startEdit = () => {
    setUrl(city?.notify_webhook_url ?? '')
    setTpl(city?.notify_template ?? '')
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
    const u = url.trim()
    if (u && !/^https:\/\//i.test(u)) return setErr('Webhook must be a full https:// URL')
    setBusy(true)
    const { error } = await supabase
      .from('cities')
      .update({ notify_webhook_url: u || null, notify_template: tpl.trim() || null })
      .eq('id', Number(cityId))
    setBusy(false)
    if (error) return setErr(error.message)
    toast.success('Notification settings updated')
    setEditing(false)
    reloadCities?.()
  }

  return (
    <>
      <div className="set-panel-head">
        <div>
          <h3>Notifications</h3>
          <div className="sub">
            Per city: a webhook URL the &ldquo;Notify&rdquo; button on a ride POSTs to
            (ride details + driver / crew phones + the rendered message), and the message
            template. Point the URL at whatever sends your WhatsApp / SMS (Zapier, Make, a
            gateway script&hellip;). Placeholders:{' '}
            <code>{'{{ref}} {{block}} {{date}} {{flight}} {{time}} {{time_label}} {{origin}} {{dest}} {{vehicle}} {{driver}}'}</code>
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
            <label htmlFor="nt-city">City</label>
            {locked ? (
              <input className="input" value={cityName} disabled />
            ) : (
              <select
                id="nt-city"
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
            )}
          </div>

          {editing ? (
            <form className="modal-form" onSubmit={submit}>
              {err && <div className="modal-error">{err}</div>}
              <div className="field">
                <label htmlFor="nt-url">Webhook URL</label>
                <input
                  id="nt-url"
                  className="input"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://hook.eu2.make.com/..."
                  autoComplete="off"
                  autoFocus
                />
              </div>
              <div className="field">
                <label htmlFor="nt-tpl">Message template</label>
                <textarea
                  id="nt-tpl"
                  className="input"
                  rows={5}
                  value={tpl}
                  onChange={(e) => setTpl(e.target.value)}
                  placeholder={NOTIFY_PLACEHOLDER}
                />
                <span className="field-hint">Leave blank to use the default template above.</span>
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
                <span className="view-label">Webhook URL</span>
                <span className="view-value">{city?.notify_webhook_url || '—'}</span>
              </div>
              <div className="view-row">
                <span className="view-label">Template</span>
                <span className="view-value" style={{ whiteSpace: 'pre-wrap', textAlign: 'right' }}>
                  {city?.notify_template || '(default)'}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}

// ── Ride Plan Settings ───────────────────────────────────────────────────
// Global (localStorage) toggles that control Ride Plan page behaviour.
// No server writes — just reads/writes localStorage keys the Ride Plan page
// already consults on mount.
const RP_TOGGLES = [
  {
    key: 'rpAddRideEnabled',
    label: 'Add Ride mode',
    description: 'When ON, the Ride Plan page uses the full Add Ride modal (Follow / No). When OFF, it switches to the quick Off-mode report form.',
    defaultOn: false,
  },
  {
    key: 'rpBufferKmEnabled',
    label: 'Buffer KM',
    description: 'When ON, block extra KM (Pickup / Drop Off buffer) is included in Off-mode actual KM calculations.',
    defaultOn: true,
  },
  {
    key: 'rpAddRowEnabled',
    label: 'Add Row',
    description: 'When ON, the Add Row button and the + icon on flight numbers are visible. Rides created via Add Row also appear on the Rides page.',
    defaultOn: true,
  },
  {
    key: 'rpShowExtraRides',
    label: 'Show extra rides',
    description: 'When ON, rides dispatched directly from the Ride page (not via Follow / No) appear as extra rows in the Ride Plan table.',
    defaultOn: true,
  },
]

function RidePlanSettingsPanel() {
  const [values, setValues] = useState(() => {
    const out = {}
    for (const t of RP_TOGGLES) {
      try {
        const stored = localStorage.getItem(t.key)
        out[t.key] = stored === null ? t.defaultOn : stored === 'true'
      } catch { out[t.key] = t.defaultOn }
    }
    return out
  })

  const toggle = (key, on) => {
    setValues((v) => ({ ...v, [key]: on }))
    try { localStorage.setItem(key, on ? 'true' : 'false') } catch {}
    toast.success('Setting saved')
  }

  return (
    <>
      <div className="set-panel-head">
        <div>
          <h3>Ride Plan</h3>
          <div className="sub">
            Controls how the Ride Plan page behaves. Changes take effect the next
            time the Ride Plan page loads.
          </div>
        </div>
      </div>

      <div className="set-form">
        {RP_TOGGLES.map((t) => {
          const on = values[t.key]
          return (
            <div key={t.key} className="set-toggle-row">
              <div className="set-toggle-info">
                <div className="set-toggle-label">{t.label}</div>
                <div className="set-toggle-desc">{t.description}</div>
              </div>
              <button
                type="button"
                className={`set-toggle-btn${on ? ' on' : ''}`}
                onClick={() => toggle(t.key, !on)}
                title={on ? 'ON — click to turn off' : 'OFF — click to turn on'}
              >
                <span className="set-toggle-knob" />
              </button>
            </div>
          )
        })}
      </div>
    </>
  )
}

// ── BusCaro Info ─────────────────────────────────────────────────────────
// Global company info shown on every driver's public profile page
// (website, email, contact, address, theme colour, logo, watermark).
// Stored in public.buscaro_info singleton row (id = 1); public read
// so the unauthenticated /d/:id page can fetch it; super_admin update only.
function BusCaroInfoPanel() {
  const logoRef = useRef(null)
  const wmRef = useRef(null)

  const [info, setInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const [form, setForm] = useState({
    website: '', email: '', contact: '', address: '', theme_color: '#fe8c03',
  })
  const [logoFile, setLogoFile] = useState(null)
  const [logoPreview, setLogoPreview] = useState(null)
  const [wmFile, setWmFile] = useState(null)
  const [wmPreview, setWmPreview] = useState(null)

  const assetUrl = (path) =>
    path ? supabase.storage.from('company-assets').getPublicUrl(path).data.publicUrl : null

  useEffect(() => {
    supabase.from('buscaro_info').select('*').eq('id', 1).single()
      .then(({ data }) => {
        setInfo(data ?? {})
        setLoading(false)
      })
  }, [])

  const startEdit = () => {
    if (!info) return
    setForm({
      website: info.website ?? '',
      email: info.email ?? '',
      contact: info.contact ?? '',
      address: info.address ?? '',
      theme_color: info.theme_color ?? '#fe8c03',
    })
    setLogoFile(null); setLogoPreview(assetUrl(info.logo_path))
    setWmFile(null);   setWmPreview(assetUrl(info.watermark_path))
    setErr('')
    setEditing(true)
  }

  const cancel = () => { setErr(''); setEditing(false) }

  const uploadAsset = async (file, name) => {
    const ext = file.name.split('.').pop()
    const path = `${name}.${ext}`
    const { error } = await supabase.storage.from('company-assets').upload(path, file, { upsert: true })
    if (error) throw error
    return path
  }

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      const payload = {
        website: form.website.trim() || null,
        email: form.email.trim() || null,
        contact: form.contact.trim() || null,
        address: form.address.trim() || null,
        theme_color: form.theme_color || '#fe8c03',
        updated_at: new Date().toISOString(),
      }
      if (logoFile) payload.logo_path = await uploadAsset(logoFile, 'logo')
      if (wmFile)   payload.watermark_path = await uploadAsset(wmFile, 'watermark')

      const { error } = await supabase.from('buscaro_info').update(payload).eq('id', 1)
      if (error) throw error

      // refresh local state
      const { data: fresh } = await supabase.from('buscaro_info').select('*').eq('id', 1).single()
      setInfo(fresh ?? info)
      setEditing(false)
      toast.success('BusCaro Info updated')
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <p className="field-hint" style={{ padding: 20 }}>Loading…</p>

  const logoUrl  = assetUrl(info?.logo_path)
  const wmUrl    = assetUrl(info?.watermark_path)
  const accent   = info?.theme_color || '#fe8c03'

  return (
    <>
      <div className="set-panel-head">
        <div>
          <h3>BusCaro Info</h3>
          <div className="sub">
            Company details shown on every driver&rsquo;s public QR profile page —
            website, contact, logo and the watermark that tiles over images to
            prevent misuse.
          </div>
        </div>
        {!editing && (
          <button type="button" className="btn btn-ghost btn-square btn-sm" onClick={startEdit}>
            <Pencil size={13} /> Edit
          </button>
        )}
      </div>

      <div className="set-form">
        {editing ? (
          <form className="modal-form" onSubmit={submit}>
            {err && <div className="modal-error">{err}</div>}

            <div className="field-row">
              <div className="field">
                <label className="field-label">Website</label>
                <input className="input" value={form.website}
                  onChange={(e) => setForm(f => ({ ...f, website: e.target.value }))}
                  placeholder="www.buscaro.com" />
              </div>
              <div className="field">
                <label className="field-label">Email</label>
                <input className="input" type="email" value={form.email}
                  onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="info@buscaro.com" />
              </div>
            </div>

            <div className="field-row">
              <div className="field">
                <label className="field-label">Contact</label>
                <input className="input" value={form.contact}
                  onChange={(e) => setForm(f => ({ ...f, contact: e.target.value }))}
                  placeholder="+92 300 000 0000" />
              </div>
              <div className="field">
                <label className="field-label">Address</label>
                <input className="input" value={form.address}
                  onChange={(e) => setForm(f => ({ ...f, address: e.target.value }))}
                  placeholder="Lahore, Pakistan" />
              </div>
            </div>

            <div className="field">
              <label className="field-label">Theme Color</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="color"
                  value={form.theme_color}
                  onChange={(e) => setForm(f => ({ ...f, theme_color: e.target.value }))}
                  style={{ width: 44, height: 36, border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', padding: 2 }}
                />
                <input className="input" style={{ width: 110 }} value={form.theme_color}
                  onChange={(e) => setForm(f => ({ ...f, theme_color: e.target.value }))}
                  placeholder="#fe8c03" maxLength={7} />
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                  Used for logo strip, headings, and icons on the public profile
                </span>
              </div>
            </div>

            <div className="field-row">
              {/* Logo upload */}
              <div className="field">
                <label className="field-label">Logo</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {logoPreview ? (
                    <img src={logoPreview} alt="Logo" style={{ height: 40, maxWidth: 100, objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 6, background: accent, padding: '4px 8px' }} />
                  ) : (
                    <div style={{ width: 60, height: 40, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', display: 'grid', placeItems: 'center', fontSize: 10, color: 'var(--muted)' }}>None</div>
                  )}
                  <label className="btn btn-ghost btn-square btn-sm" style={{ cursor: 'pointer' }}>
                    Upload
                    <input ref={logoRef} type="file" accept="image/*" style={{ display: 'none' }}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) { setLogoFile(f); setLogoPreview(URL.createObjectURL(f)) } }} />
                  </label>
                </div>
                <span className="field-hint">PNG/SVG on a transparent or coloured background</span>
              </div>

              {/* Watermark upload */}
              <div className="field">
                <label className="field-label">Watermark Image</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {wmPreview ? (
                    <img src={wmPreview} alt="Watermark" style={{ height: 40, maxWidth: 100, objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 6, background: '#eee', padding: 4 }} />
                  ) : (
                    <div style={{ width: 60, height: 40, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', display: 'grid', placeItems: 'center', fontSize: 10, color: 'var(--muted)' }}>None</div>
                  )}
                  <label className="btn btn-ghost btn-square btn-sm" style={{ cursor: 'pointer' }}>
                    Upload
                    <input ref={wmRef} type="file" accept="image/*" style={{ display: 'none' }}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) { setWmFile(f); setWmPreview(URL.createObjectURL(f)) } }} />
                  </label>
                </div>
                <span className="field-hint">Tiled over images on the public profile to prevent misuse</span>
              </div>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn btn-ghost btn-square" onClick={cancel}>Cancel</button>
              <button type="submit" className="btn btn-square" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        ) : (
          <div>
            {/* Color swatch row */}
            <div className="view-row">
              <span className="view-label">Theme Color</span>
              <span className="view-value" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 18, height: 18, borderRadius: 4, background: accent, border: '1px solid var(--border)', display: 'inline-block' }} />
                {accent}
              </span>
            </div>
            <div className="view-row">
              <span className="view-label">Website</span>
              <span className="view-value">{info?.website || '—'}</span>
            </div>
            <div className="view-row">
              <span className="view-label">Email</span>
              <span className="view-value">{info?.email || '—'}</span>
            </div>
            <div className="view-row">
              <span className="view-label">Contact</span>
              <span className="view-value">{info?.contact || '—'}</span>
            </div>
            <div className="view-row">
              <span className="view-label">Address</span>
              <span className="view-value">{info?.address || '—'}</span>
            </div>
            <div className="view-row">
              <span className="view-label">Logo</span>
              <span className="view-value">
                {logoUrl
                  ? <img src={logoUrl} alt="Logo" style={{ height: 34, objectFit: 'contain', background: accent, borderRadius: 6, padding: '3px 8px' }} />
                  : '— (using default /logo.png)'}
              </span>
            </div>
            <div className="view-row">
              <span className="view-label">Watermark</span>
              <span className="view-value">
                {wmUrl
                  ? <img src={wmUrl} alt="Watermark" style={{ height: 34, objectFit: 'contain', background: '#eee', borderRadius: 6, padding: 4 }} />
                  : '— (none set)'}
              </span>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ── Account Manager ──────────────────────────────────────────────────────────
const BLANK_AM = { name: '', designation: '', email: '', contact: '' }

function AccountManagerPanel() {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [editId, setEditId]   = useState(null) // uuid = editing, 'new' = adding
  const [form, setForm]       = useState(BLANK_AM)
  const [saving, setSaving]   = useState(false)
  const [deleting, setDeleting] = useState(null)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('account_managers')
      .select('id, name, designation, email, contact')
      .order('name')
    setRows(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const openAdd = () => { setForm(BLANK_AM); setEditId('new') }
  const openEdit = (r) => { setForm({ name: r.name, designation: r.designation ?? '', email: r.email ?? '', contact: r.contact ?? '' }); setEditId(r.id) }
  const cancel = () => { setEditId(null); setForm(BLANK_AM) }

  const save = async () => {
    if (!form.name.trim()) { toast.error('Name is required'); return }
    setSaving(true)
    const payload = { name: form.name.trim(), designation: form.designation.trim() || null, email: form.email.trim() || null, contact: form.contact.trim() || null }
    const { error } = editId === 'new'
      ? await supabase.from('account_managers').insert(payload)
      : await supabase.from('account_managers').update(payload).eq('id', editId)
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success(editId === 'new' ? 'Account manager added' : 'Saved')
    cancel()
    load()
  }

  const doDelete = async (id) => {
    setDeleting(id)
    const { error } = await supabase.from('account_managers').delete().eq('id', id)
    setDeleting(null)
    if (error) { toast.error(error.message); return }
    toast.success('Deleted')
    load()
  }

  const f = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }))

  return (
    <>
      <div className="set-panel-head">
        <h2 className="set-panel-title">Account Manager</h2>
        {editId === null && (
          <button className="btn btn-sm" onClick={openAdd}><Plus size={14} /> Add</button>
        )}
      </div>
      <div style={{ borderBottom: '1px solid var(--border)', marginBottom: 16 }} />

      {/* Add / Edit form */}
      {editId !== null && (
        <div style={{ marginBottom: 20, padding: '16px', background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700 }}>{editId === 'new' ? 'Add Account Manager' : 'Edit Account Manager'}</h3>
          <div className="field-row" style={{ marginBottom: 10 }}>
            <div className="field">
              <label className="label">Name <span style={{ color: 'red' }}>*</span></label>
              <input className="input" value={form.name} onChange={f('name')} placeholder="Full name" />
            </div>
            <div className="field">
              <label className="label">Designation</label>
              <input className="input" value={form.designation} onChange={f('designation')} placeholder="e.g. Operations Manager" />
            </div>
          </div>
          <div className="field-row" style={{ marginBottom: 14 }}>
            <div className="field">
              <label className="label">Email</label>
              <input className="input" type="email" value={form.email} onChange={f('email')} placeholder="email@buscaro.com" />
            </div>
            <div className="field">
              <label className="label">Contact</label>
              <input className="input" value={form.contact} onChange={f('contact')} placeholder="+92 3XX XXXXXXX" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-square btn-sm" onClick={cancel}>Cancel</button>
            <button className="btn btn-sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <p className="secondary">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="secondary">No account managers yet.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Name', 'Designation', 'Email', 'Contact', ''].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '6px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--muted)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '8px 10px', fontWeight: 600 }}>{r.name}</td>
                <td style={{ padding: '8px 10px', color: 'var(--muted)' }}>{r.designation || '—'}</td>
                <td style={{ padding: '8px 10px', color: 'var(--muted)' }}>{r.email || '—'}</td>
                <td style={{ padding: '8px 10px', color: 'var(--muted)' }}>{r.contact || '—'}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn btn-ghost btn-square btn-sm" onClick={() => openEdit(r)} style={{ marginRight: 4 }}><Pencil size={13} /></button>
                  <button className="btn btn-ghost btn-square btn-sm" onClick={() => doDelete(r.id)} disabled={deleting === r.id} style={{ color: 'var(--danger)' }}><Trash2 size={13} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
