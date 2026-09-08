import { useCallback, useEffect, useMemo, useState } from 'react'
import { MapContainer, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import toast from 'react-hot-toast'
import { ChevronLeft, ChevronRight, Map as MapIcon, RefreshCw, Rows3, Shield, Wand2 } from 'lucide-react'
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
  origin_label, dest_label, waypoints, route_geometry, vehicle_id, city_id, shift, driver_id,
  vehicle:vehicles(ref_no, vehicle_no),
  ride_crew(seq, crew:crew(name))
`
const COLORS = ['#3471b8', '#1e874b', '#b7791f', '#8b5cf6', '#c0392b', '#0e7490', '#be185d']
const minsOf = (iso) => {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}
const ms = (iso) => new Date(iso).getTime()
const overlaps = (aS, aE, list) => list.some((b) => aS < b.e && aE > b.s)

export default function VehicleBoard() {
  const { can } = useAuth()
  const { cityId, cityName } = useCity()
  const canView = can('rides', 'view')

  const canEdit = can('rides', 'edit')

  const [date, setDate] = useState(pkToday)
  const [tab, setTab] = useState('board') // board | map
  const [rides, setRides] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [loading, setLoading] = useState(true)
  const [openRide, setOpenRide] = useState(null)
  const [autoOn, setAutoOn] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [dragOverV, setDragOverV] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    let rq = supabase.from('rides').select(RIDE_SELECT).eq('ride_date', date)
    if (cityId != null) rq = rq.eq('city_id', cityId)
    let vq = supabase
      .from('vehicles')
      .select('id, ref_no, vehicle_no, city_id, is_active, driver_id, night_driver_id, driver:drivers!driver_id(name)')
    if (cityId != null) vq = vq.eq('city_id', cityId)
    const [{ data: rd, error: re }, { data: vd, error: ve }] = await Promise.all([rq, vq])
    if (re || ve) toast.error('Could not load the board')
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
      if (!r.vehicle_id) continue
      if (!m.has(r.vehicle_id)) m.set(r.vehicle_id, [])
      m.get(r.vehicle_id).push(r)
    }
    return m
  }, [rides])

  const unassigned = useMemo(
    () => rides.filter((r) => !r.vehicle_id).sort((a, b) => (a.start_at || '').localeCompare(b.start_at || '')),
    [rides],
  )

  // move a ride onto a vehicle (or off it, vId = null). Warns on a time clash
  // but still applies it - the dispatcher's call.
  const assignRide = useCallback(
    async (rideId, vId) => {
      const ride = rides.find((r) => r.id === rideId)
      if (!ride || ride.vehicle_id === vId) return
      const veh = vId ? vehicles.find((v) => v.id === vId) : null
      if (vId && ride.start_at && ride.end_at) {
        const clash = (byVehicle.get(vId) || []).filter(
          (o) => o.id !== rideId && o.start_at && o.end_at,
        ).map((o) => ({ s: ms(o.start_at), e: ms(o.end_at) }))
        if (overlaps(ms(ride.start_at), ms(ride.end_at), clash)) {
          toast(`Heads up — ${veh?.vehicle_no} already has a ride in that window`, { icon: '⚠️' })
        }
      }
      const patch = vId
        ? { vehicle_id: vId, shift: ride.shift || 'day', driver_id: veh?.driver_id ?? null }
        : { vehicle_id: null, shift: null, driver_id: null }
      const { error } = await supabase.from('rides').update(patch).eq('id', rideId)
      if (error) return toast.error(error.message)
      toast.success(vId ? `#${ride.ref_no} → ${veh?.vehicle_no}` : `#${ride.ref_no} unassigned`)
      load()
    },
    [rides, vehicles, byVehicle, load],
  )

  const runAutoAssign = useCallback(async () => {
    const pool = unassigned.filter((r) => r.start_at && r.end_at)
    if (!pool.length) return
    setAssigning(true)
    // working busy windows per vehicle (seed from what's already booked)
    const busy = new Map(
      vehicles.map((v) => [
        v.id,
        (byVehicle.get(v.id) || [])
          .filter((r) => r.start_at && r.end_at)
          .map((r) => ({ s: ms(r.start_at), e: ms(r.end_at) })),
      ]),
    )
    const updates = []
    let skipped = 0
    for (const r of pool) {
      const s = ms(r.start_at)
      const e = ms(r.end_at)
      const v = vehicles.find((v) => v.city_id === r.city_id && !overlaps(s, e, busy.get(v.id) || []))
      if (!v) {
        skipped++
        continue
      }
      busy.get(v.id).push({ s, e })
      updates.push({ id: r.id, vehicle_id: v.id, shift: r.shift || 'day', driver_id: v.driver_id ?? null })
    }
    for (const u of updates) {
      await supabase
        .from('rides')
        .update({ vehicle_id: u.vehicle_id, shift: u.shift, driver_id: u.driver_id })
        .eq('id', u.id)
    }
    setAssigning(false)
    toast.success(
      `Assigned ${updates.length}${skipped ? ` · ${skipped} couldn't be placed` : ''}`,
    )
    load()
  }, [unassigned, vehicles, byVehicle, load])

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
            {fmtDate(date)} · {cityName} · {rides.length - unassigned.length} on vehicles
            {unassigned.length ? ` · ${unassigned.length} unassigned` : ''}
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
          {canEdit && tab === 'board' && (
            <>
              <label className="vb-autotoggle" title="Enable the Auto-assign button">
                <input
                  type="checkbox"
                  checked={autoOn}
                  onChange={(e) => setAutoOn(e.target.checked)}
                />
                Auto
              </label>
              <button
                className="btn btn-ghost btn-square btn-sm"
                disabled={!autoOn || assigning || unassigned.length === 0}
                onClick={runAutoAssign}
              >
                <Wand2 size={14} /> {assigning ? 'Assigning…' : `Auto-assign ${unassigned.length || ''}`}
              </button>
            </>
          )}
          <div className="vb-modeswitch">
            <button className={tab === 'board' ? 'on' : ''} onClick={() => setTab('board')}>
              <Rows3 size={13} /> Board
            </button>
            <button className={tab === 'map' ? 'on' : ''} onClick={() => setTab('map')}>
              <MapIcon size={13} /> Map
            </button>
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
            <>
              {canEdit && (
                <div
                  className={`vb-unassigned${unassigned.length ? '' : ' empty'}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    const id = e.dataTransfer.getData('text/ride')
                    if (id) assignRide(id, null)
                  }}
                >
                  <span className="vb-unassigned-head">
                    Unassigned{unassigned.length ? ` · ${unassigned.length}` : ''}
                  </span>
                  {unassigned.length === 0 ? (
                    <span className="vb-unassigned-hint">
                      Every ride has a vehicle. Drag a bar here to unassign it.
                    </span>
                  ) : (
                    unassigned.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        draggable
                        className={`vb-chip block-${r.block_type}`}
                        onDragStart={(e) => e.dataTransfer.setData('text/ride', r.id)}
                        onClick={() => setOpenRide(r)}
                        title={`#${r.ref_no} ${blockLabel(r.block_type)} · ${r.start_at ? fmtTimeOnly12(r.start_at) : 'no time'}`}
                      >
                        #{r.ref_no} {blockLabel(r.block_type)}
                        {r.start_at ? ` · ${fmtTimeOnly12(r.start_at)}` : ''}
                      </button>
                    ))
                  )}
                </div>
              )}

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
                    <div
                      className={`vb-track${dragOverV === v.id ? ' drop-over' : ''}`}
                      onDragOver={canEdit ? (e) => e.preventDefault() : undefined}
                      onDragEnter={canEdit ? () => setDragOverV(v.id) : undefined}
                      onDragLeave={canEdit ? () => setDragOverV((c) => (c === v.id ? null : c)) : undefined}
                      onDrop={
                        canEdit
                          ? (e) => {
                              e.preventDefault()
                              setDragOverV(null)
                              const id = e.dataTransfer.getData('text/ride')
                              if (id) assignRide(id, v.id)
                            }
                          : undefined
                      }
                    >
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
                            draggable={canEdit}
                            className={`vb-bar block-${r.block_type}`}
                            style={{ left: pct(s), width: `calc(${pct(e)} - ${pct(s)})` }}
                            onDragStart={(ev) => ev.dataTransfer.setData('text/ride', r.id)}
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
            </>
          )}
        </div>
      ) : (
        <BoardMap rides={rides} onPick={setOpenRide} />
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
