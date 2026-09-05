import { useCallback, useEffect, useMemo, useState } from 'react'
import { MapContainer, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import toast from 'react-hot-toast'
import { ChevronLeft, ChevronRight, Map as MapIcon, RefreshCw, Rows3, Satellite, Shield } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { useCity } from '../context/useCity'
import { fmtDate } from '../lib/format'
import { addDays, fmtTimeOnly12, pkToday } from '../lib/time'
import { blockLabel } from '../lib/rideRoute'
import { gmapsRoute } from '../lib/ors'
import Modal from '../components/Modal'
import '../components/stop-map.css'
import './VehicleBoard.css'

const RIDE_SELECT = `
  id, ref_no, block_type, ride_date, start_at, end_at, distance_km, duration_min,
  origin_label, dest_label, waypoints, route_geometry, vehicle_id,
  vehicle:vehicles(ref_no, vehicle_no),
  ride_crew(seq, crew:crew(name))
`
const COLORS = ['#3471b8', '#1e874b', '#b7791f', '#8b5cf6', '#c0392b', '#0e7490', '#be185d']
const minsOf = (iso) => {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}

export default function VehicleBoard() {
  const { can } = useAuth()
  const { cityId, cityName } = useCity()
  const canView = can('rides', 'view')

  const [date, setDate] = useState(pkToday)
  const [tab, setTab] = useState('board') // board | map | tracker
  const [rides, setRides] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [loading, setLoading] = useState(true)
  const [openRide, setOpenRide] = useState(null)
  // one global sharing link (all vehicles, all cities), not per-day/city -
  // fetched once, independent of `load()` below.
  const [trackerUrl, setTrackerUrl] = useState('')
  useEffect(() => {
    if (!canView) return
    supabase
      .from('app_settings')
      .select('tracker_url')
      .eq('id', true)
      .single()
      .then(({ data }) => setTrackerUrl(data?.tracker_url || ''))
  }, [canView])

  const load = useCallback(async () => {
    setLoading(true)
    let rq = supabase.from('rides').select(RIDE_SELECT).eq('ride_date', date).not('vehicle_id', 'is', null)
    if (cityId != null) rq = rq.eq('city_id', cityId)
    let vq = supabase.from('vehicles').select('id, ref_no, vehicle_no, is_active, driver:drivers(name)')
    if (cityId != null) vq = vq.eq('city_id', cityId)
    const [{ data: rd, error: re }, { data: vd }] = await Promise.all([rq, vq])
    if (re) toast.error('Could not load the board')
    setRides(rd ?? [])
    setVehicles((vd ?? []).filter((v) => v.is_active))
    setLoading(false)
  }, [date, cityId])

  useEffect(() => {
    if (canView) load()
  }, [canView, load])

  // time window for the gantt
  const win = useMemo(() => {
    const withTimes = rides.filter((r) => r.start_at && r.end_at)
    if (!withTimes.length) return { start: 6 * 60, end: 22 * 60 }
    let lo = Math.min(...withTimes.map((r) => minsOf(r.start_at)))
    let hi = Math.max(...withTimes.map((r) => minsOf(r.end_at)))
    lo = Math.max(0, Math.floor(lo / 60) * 60 - 30)
    hi = Math.min(24 * 60, Math.ceil(hi / 60) * 60 + 30)
    if (hi - lo < 6 * 60) hi = Math.min(24 * 60, lo + 6 * 60)
    return { start: lo, end: hi }
  }, [rides])
  const span = win.end - win.start
  const pct = (m) => `${((m - win.start) / span) * 100}%`
  const hours = []
  for (let h = Math.ceil(win.start / 60); h * 60 <= win.end; h++) hours.push(h)

  const byVehicle = useMemo(() => {
    const m = new Map()
    for (const r of rides) {
      if (!m.has(r.vehicle_id)) m.set(r.vehicle_id, [])
      m.get(r.vehicle_id).push(r)
    }
    return m
  }, [rides])

  if (!canView) {
    return (
      <div className="page">
        <div className="card placeholder-card">
          <Shield size={28} color="var(--muted)" />
          <h2>No access</h2>
          <p>You don&rsquo;t have permission to view the vehicle board.</p>
        </div>
      </div>
    )
  }

  const rows = vehicles.map((v) => ({ v, rides: byVehicle.get(v.id) || [] }))

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Vehicle Board</h1>
          <p className="page-subtitle">
            {fmtDate(date)} · {cityName} · {rides.length} booked ride(s)
          </p>
        </div>
        <div className="page-actions">
          <button className="icon-btn" onClick={() => setDate(addDays(date, -1))} title="Previous day">
            <ChevronLeft size={15} />
          </button>
          <input
            type="date"
            className="filter-select"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <button className="icon-btn" onClick={() => setDate(addDays(date, 1))} title="Next day">
            <ChevronRight size={15} />
          </button>
          <button className="btn btn-ghost btn-square btn-sm" onClick={() => setDate(pkToday())}>
            Today
          </button>
          <button className="icon-btn" onClick={load} title="Refresh">
            <RefreshCw size={15} />
          </button>
          <div className="vb-modeswitch">
            <button className={tab === 'board' ? 'on' : ''} onClick={() => setTab('board')}>
              <Rows3 size={13} /> Board
            </button>
            <button className={tab === 'map' ? 'on' : ''} onClick={() => setTab('map')}>
              <MapIcon size={13} /> Map
            </button>
            {trackerUrl && (
              <button className={tab === 'tracker' ? 'on' : ''} onClick={() => setTab('tracker')}>
                <Satellite size={13} /> Tracker
              </button>
            )}
          </div>
        </div>
      </div>

      {tab === 'board' ? (
        <div className="vb-wrap">
          {loading ? (
            <div style={{ padding: 24, color: 'var(--muted)' }}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 24, color: 'var(--muted)' }}>No vehicles in this city.</div>
          ) : (
            <div className="vb-grid">
              <div className="vb-axis">
                <div className="vb-axis-label" />
                <div className="vb-axis-track">
                  {hours.map((h) => (
                    <span key={h} className="vb-hour" style={{ left: pct(h * 60) }}>
                      {h % 12 || 12}
                      {h < 12 || h === 24 ? 'a' : 'p'}
                    </span>
                  ))}
                </div>
              </div>
              {rows.map(({ v, rides: vr }) => (
                <div className="vb-row" key={v.id}>
                  <div className="vb-veh">
                    <span className="primary">
                      ({v.ref_no}) {v.vehicle_no}
                    </span>
                    <span className="secondary">{v.driver?.name || 'no driver'}</span>
                  </div>
                  <div className="vb-track">
                    {hours.map((h) => (
                      <span key={h} className="vb-gridline" style={{ left: pct(h * 60) }} />
                    ))}
                    {vr.map((r) => {
                      if (!r.start_at || !r.end_at) return null
                      const s = minsOf(r.start_at)
                      const e = Math.max(s + 8, minsOf(r.end_at))
                      return (
                        <button
                          key={r.id}
                          type="button"
                          className={`vb-bar block-${r.block_type}`}
                          style={{ left: pct(s), width: `calc(${pct(e)} - ${pct(s)})` }}
                          onClick={() => setOpenRide(r)}
                          title={`#${r.ref_no} ${blockLabel(r.block_type)} · ${fmtTimeOnly12(r.start_at)}–${fmtTimeOnly12(r.end_at)}`}
                        >
                          #{r.ref_no} {blockLabel(r.block_type)}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : tab === 'map' ? (
        <BoardMap rides={rides} onPick={setOpenRide} />
      ) : (
        <TrackerFrame url={trackerUrl} />
      )}

      {openRide && (
        <Modal open onClose={() => setOpenRide(null)} title={`Ride ${openRide.ref_no}`} width={440}>
          <div className="modal-form">
            {[
              ['Block', blockLabel(openRide.block_type)],
              ['Vehicle', openRide.vehicle ? `(${openRide.vehicle.ref_no}) ${openRide.vehicle.vehicle_no}` : '—'],
              [
                'Crew',
                [...(openRide.ride_crew || [])]
                  .sort((a, b) => a.seq - b.seq)
                  .map((x) => x.crew?.name)
                  .filter(Boolean)
                  .join(', ') || '—',
              ],
              ['Origin', openRide.origin_label || '—'],
              ['Destination', openRide.dest_label || '—'],
              ['Starts', openRide.start_at ? fmtTimeOnly12(openRide.start_at) : '—'],
              ['Ends (vehicle free)', openRide.end_at ? fmtTimeOnly12(openRide.end_at) : '—'],
              ['Distance', openRide.distance_km != null ? `${openRide.distance_km} km` : '—'],
            ].map(([k, val]) => (
              <div className="view-row" key={k}>
                <span className="view-label">{k}</span>
                <span className="view-value">{val}</span>
              </div>
            ))}
            <div className="modal-actions">
              {gmapsRoute(openRide.waypoints) && (
                <a
                  className="btn btn-ghost btn-square btn-sm"
                  href={gmapsRoute(openRide.waypoints)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Route in Google Maps
                </a>
              )}
              <button type="button" className="btn btn-square" onClick={() => setOpenRide(null)}>
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// Embeds the fleet's GPS tracker sharing link (Settings -> Live Tracker) -
// one link covers every vehicle, so there's nothing per-vehicle to pick here.
function TrackerFrame({ url }) {
  return (
    <div className="stop-map" style={{ height: 640 }}>
      <iframe src={url} title="Live Tracker" style={{ width: '100%', height: '100%', border: 0 }} />
    </div>
  )
}

function BoardMap({ rides, onPick }) {
  const lines = rides
    .map((r) => {
      // prefer the stored road-following geometry (saved once at ride
      // creation/edit time, no ORS call here) - straight waypoints are only a
      // fallback for rides saved before route_geometry existed, or where ORS
      // had no key/failed.
      const geom = (r.route_geometry || [])
        .map((p) => [Number(p[0]), Number(p[1])])
        .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b))
      const straight = [...(r.waypoints || [])]
        .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
        .map((p) => [Number(p.lat), Number(p.lng)])
        .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b))
      return { r, pts: geom.length > 1 ? geom : straight }
    })
    .filter((x) => x.pts.length > 1)

  const all = lines.flatMap((x) => x.pts)
  const center = all[0] || [30.3753, 69.3451]

  return (
    <div className="stop-map" style={{ height: 640 }}>
      <MapContainer center={center} zoom={11} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        <FitAll all={all} />
        {lines.map((x, i) => (
          <Polyline
            key={x.r.id}
            positions={x.pts}
            pathOptions={{ color: COLORS[i % COLORS.length], weight: 4 }}
            eventHandlers={{ click: () => onPick(x.r) }}
          >
            <Tooltip sticky>
              #{x.r.ref_no} {blockLabel(x.r.block_type)}
            </Tooltip>
          </Polyline>
        ))}
      </MapContainer>
      {lines.length === 0 && <span className="stop-map-hint">No routed rides for this day</span>}
    </div>
  )
}

function FitAll({ all }) {
  const map = useMap()
  useEffect(() => {
    const t = setTimeout(() => {
      map.invalidateSize()
      if (all.length > 1) {
        try {
          map.fitBounds(L.latLngBounds(all).pad(0.2))
        } catch {
          /* ignore */
        }
      }
    }, 200)
    return () => clearTimeout(t)
  }, [map, all])
  return null
}
