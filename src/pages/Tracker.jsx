import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Marker, TileLayer, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { ArrowLeft, Map as MapIcon, Radio, Search, Shield } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { useCity } from '../context/useCity'
import { fetchFleetTracker } from '../lib/tracker'
import '../components/stop-map.css'
import './Tracker.css'

const POLL_MS = 15000
const STALE_MS = 60 * 60 * 1000
const FALLBACK = [30.3753, 69.3451]
const STATUS_LABEL = { green: 'Moving', red: 'Stopped', blue: 'Offline', yellow: 'Engine on' }
const STATUS_COLOR = { green: '#1e874b', red: '#c0392b', blue: '#0e7490', yellow: '#b7791f' }
const colorOf = (s) => STATUS_COLOR[s] || '#c9ccd1'
const plate = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, '')

const markerIcon = (status, on) =>
  L.divIcon({
    className: '',
    html: `<span style="display:block;width:${on ? 20 : 15}px;height:${on ? 20 : 15}px;border-radius:50%;background:${colorOf(status)};border:${on ? 3 : 2}px solid #fff;box-shadow:0 0 ${on ? 9 : 4}px rgba(0,0,0,.5)"></span>`,
    iconSize: [on ? 20 : 15, on ? 20 : 15],
    iconAnchor: [on ? 10 : 7, on ? 10 : 7],
  })

function FlyTo({ target }) {
  const map = useMap()
  useEffect(() => {
    map.invalidateSize()
    if (target) map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 16), { duration: 0.8 })
  }, [map, target])
  return null
}

function FitAll({ pts }) {
  const map = useMap()
  const done = useRef(false)
  useEffect(() => {
    if (done.current || pts.length === 0) return
    done.current = true
    const id = setTimeout(() => {
      map.invalidateSize()
      if (pts.length === 1) map.setView([pts[0].lat, pts[0].lng], 13)
      else {
        try {
          map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng])).pad(0.25))
        } catch {
          /* ignore */
        }
      }
    }, 200)
    return () => clearTimeout(id)
  }, [map, pts])
  return null
}

export default function Tracker() {
  const { can } = useAuth()
  const { cityId, cityName, allowedCities } = useCity()
  const canView = can('rides', 'view')

  const trackerCities = useMemo(() => {
    const cs = allowedCities.filter((c) => c.tracker_url)
    return cityId == null ? cs : cs.filter((c) => c.id === cityId)
  }, [allowedCities, cityId])
  const links = useMemo(
    () => [...new Set(trackerCities.map((c) => c.tracker_url))],
    [trackerCities],
  )

  // full vehicle roster from our own DB - so the list never flickers
  const [vehicles, setVehicles] = useState([])
  useEffect(() => {
    if (!canView) return
    let alive = true
    let q = supabase.from('vehicles').select('id, ref_no, vehicle_no, tracker_url, is_active, city_id')
    if (cityId != null) q = q.eq('city_id', cityId)
    q.then(({ data }) => {
      if (alive) setVehicles((data ?? []).filter((v) => v.is_active))
    })
    return () => {
      alive = false
    }
  }, [canView, cityId])

  // live positions - AI Track's /items only returns recently-pinged vehicles,
  // so accumulate by plate; drop after STALE_MS. Reset on a city switch.
  const [fixes, setFixes] = useState({})
  useEffect(() => {
    setFixes({})
    if (!canView || links.length === 0) return
    let alive = true
    const poll = async () => {
      const fresh = (await Promise.all(links.map(fetchFleetTracker))).flat()
      if (!alive) return
      const now = Date.now()
      setFixes((prev) => {
        const next = { ...prev }
        for (const it of fresh) next[plate(it.name)] = { ...it, seenAt: now }
        for (const k of Object.keys(next)) if (now - next[k].seenAt > STALE_MS) delete next[k]
        return next
      })
    }
    poll()
    const id = setInterval(poll, POLL_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, links])

  const [q, setQ] = useState('')
  const [selId, setSelId] = useState(null)
  const [flyTarget, setFlyTarget] = useState(null)
  const [view, setView] = useState('embed') // 'embed' (AI Track) | 'map' (ours)

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return vehicles
      .map((v) => ({ v, fix: fixes[plate(v.vehicle_no)] || null }))
      .filter(({ v }) => !s || v.vehicle_no.toLowerCase().includes(s))
      .sort((a, b) => {
        if (!!a.fix !== !!b.fix) return a.fix ? -1 : 1
        return a.v.vehicle_no.localeCompare(b.v.vehicle_no)
      })
  }, [vehicles, fixes, q])

  const mapPts = useMemo(
    () => rows.filter((r) => r.fix).map((r) => ({ id: r.v.id, ...r.fix, name: r.v.vehicle_no })),
    [rows],
  )
  const selRow = rows.find((r) => r.v.id === selId) || null

  const pick = (row) => {
    setSelId(row.v.id)
    if (row.fix) {
      setFlyTarget({ lat: row.fix.lat, lng: row.fix.lng, t: Date.now() })
      // no per-vehicle AI Track link to focus -> the interactive Map is where
      // a click can actually zoom, so hop to it
      if (view === 'embed' && !row.v.tracker_url) setView('map')
    }
  }

  if (!canView) {
    return (
      <div className="page">
        <div className="card placeholder-card">
          <Shield size={28} color="var(--muted)" />
          <h2>No access</h2>
          <p>You don&rsquo;t have permission to view the tracker.</p>
        </div>
      </div>
    )
  }

  const liveCount = rows.filter((r) => r.fix).length
  const single = trackerCities.length === 1
  // AI Track view: a picked vehicle with its own link -> focus it; else the fleet
  const focusEmbed = view === 'embed' && selRow?.v.tracker_url

  return (
    <div className="page tk-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Tracker</h1>
          <p className="page-subtitle">
            {cityName} · {liveCount} of {vehicles.length} vehicle{vehicles.length === 1 ? '' : 's'} live
          </p>
        </div>
      </div>

      {links.length === 0 ? (
        <div className="card placeholder-card">
          <Shield size={28} color="var(--muted)" />
          <h2>No tracker link set</h2>
          <p>Add {cityId == null ? 'a' : "this city's"} sharing link at Settings → Live Tracker.</p>
        </div>
      ) : (
        <div className="tk-layout">
          <aside className="tk-list">
            <div className="tk-list-head">Vehicles</div>
            <div className="tk-search">
              <Search size={13} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search vehicle…"
                autoComplete="off"
              />
            </div>
            <div className="tk-list-scroll">
              {rows.length === 0 ? (
                <span className="tk-empty">
                  {vehicles.length === 0 ? 'No vehicles in this city.' : 'No match.'}
                </span>
              ) : (
                rows.map(({ v, fix }) => (
                  <button
                    key={v.id}
                    type="button"
                    className={`tk-list-item${selId === v.id ? ' on' : ''}`}
                    onClick={() => pick({ v, fix })}
                  >
                    <span className="tk-dot" style={{ background: fix ? colorOf(fix.status) : '#c9ccd1' }} />
                    <span className="tk-item-main">
                      <span className="tk-item-name">{v.vehicle_no}</span>
                      <span className="tk-item-sub">
                        {fix ? `${STATUS_LABEL[fix.status] || '—'} · ${Math.round(fix.speed)} kph` : 'No signal'}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </aside>

          <div className="tk-view">
            <div className="tk-bar">
              {selRow ? (
                <div className="tk-selbar">
                  <button type="button" className="tk-back" onClick={() => setSelId(null)}>
                    <ArrowLeft size={12} /> All vehicles
                  </button>
                  <span className="tk-view-name">{selRow.v.vehicle_no}</span>
                  {selRow.fix && (
                    <span className="tk-view-sub">
                      · {STATUS_LABEL[selRow.fix.status] || '—'} · {Math.round(selRow.fix.speed)} kph
                    </span>
                  )}
                </div>
              ) : (
                <span />
              )}
              <div className="tk-viewswitch">
                <button className={view === 'embed' ? 'on' : ''} onClick={() => setView('embed')}>
                  <Radio size={13} /> AI Track
                </button>
                <button className={view === 'map' ? 'on' : ''} onClick={() => setView('map')}>
                  <MapIcon size={13} /> Map
                </button>
              </div>
            </div>
            {view === 'embed' ? (
              focusEmbed ? (
                <div className="stop-map tk-map">
                  <iframe
                    key={selRow.v.id}
                    src={selRow.v.tracker_url}
                    title={`Tracker — ${selRow.v.vehicle_no}`}
                    style={{ width: '100%', height: '100%', border: 0 }}
                  />
                </div>
              ) : (
                trackerCities.map((c) => (
                  <div key={c.id} className="tk-frame-wrap">
                    {!single && <div className="tk-frame-label">{c.name}</div>}
                    <div className={`stop-map tk-map${single ? '' : ' tk-map-split'}`}>
                      <iframe
                        src={c.tracker_url}
                        title={`Tracker — ${c.name}`}
                        style={{ width: '100%', height: '100%', border: 0 }}
                      />
                    </div>
                  </div>
                ))
              )
            ) : (
              <div className="stop-map tk-map">
                <MapContainer center={FALLBACK} zoom={6} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  />
                  <FitAll pts={mapPts} />
                  <FlyTo target={flyTarget} />
                  {mapPts.map((v) => (
                    <Marker
                      key={v.id}
                      position={[v.lat, v.lng]}
                      icon={markerIcon(v.status, selId === v.id)}
                      zIndexOffset={selId === v.id ? 1000 : 0}
                      eventHandlers={{ click: () => pick({ v: { id: v.id }, fix: v }) }}
                    >
                      <Tooltip permanent={selId === v.id} direction="top" offset={[0, -10]}>
                        {v.name} · {Math.round(v.speed)} kph
                      </Tooltip>
                    </Marker>
                  ))}
                </MapContainer>
                {mapPts.length === 0 && <span className="stop-map-hint">Waiting for live positions…</span>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
