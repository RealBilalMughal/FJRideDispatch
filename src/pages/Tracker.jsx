import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Marker, TileLayer, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Search, Shield } from 'lucide-react'
import { useAuth } from '../context/useAuth'
import { useCity } from '../context/useCity'
import { fetchFleetTracker } from '../lib/tracker'
import '../components/stop-map.css'
import './Tracker.css'

const POLL_MS = 15000
const FALLBACK = [30.3753, 69.3451] // ~ centre of Pakistan
const STATUS_LABEL = { green: 'Moving', red: 'Stopped', blue: 'Offline', yellow: 'Engine on' }
const STATUS_COLOR = { green: '#1e874b', red: '#c0392b', blue: '#0e7490', yellow: '#b7791f' }
const colorOf = (s) => STATUS_COLOR[s] || '#727272'

const markerIcon = (status, on) =>
  L.divIcon({
    className: '',
    html: `<span style="display:block;width:${on ? 18 : 14}px;height:${on ? 18 : 14}px;border-radius:50%;background:${colorOf(status)};border:${on ? 3 : 2}px solid #fff;box-shadow:0 0 ${on ? 8 : 4}px rgba(0,0,0,.45)"></span>`,
    iconSize: [on ? 18 : 14, on ? 18 : 14],
    iconAnchor: [on ? 9 : 7, on ? 9 : 7],
  })

// fly to the selected vehicle whenever `target` (bumped on every pick) changes
function FlyTo({ target }) {
  const map = useMap()
  useEffect(() => {
    map.invalidateSize()
    if (target) map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 16), { duration: 0.8 })
  }, [map, target])
  return null
}

// fit every vehicle in view once, on the first load that has positions
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

  // unique sharing links for the cities in play (one city selected, or all)
  const links = useMemo(() => {
    const cs = allowedCities.filter((c) => c.tracker_url)
    const scoped = cityId == null ? cs : cs.filter((c) => c.id === cityId)
    return [...new Set(scoped.map((c) => c.tracker_url))]
  }, [allowedCities, cityId])

  const [items, setItems] = useState([])
  const [q, setQ] = useState('')
  const [selId, setSelId] = useState(null)
  const [flyTarget, setFlyTarget] = useState(null)

  // The AI Track /items endpoint only returns vehicles that have pinged
  // recently, not the whole roster in one call - so accumulate across polls
  // (update by id, drop anything unseen for STALE_MS). Reset on a city switch.
  const STALE_MS = 10 * 60 * 1000
  useEffect(() => {
    setItems([])
    if (!canView || links.length === 0) return
    let alive = true
    const poll = async () => {
      const fresh = (await Promise.all(links.map(fetchFleetTracker))).flat()
      if (!alive) return
      const now = Date.now()
      setItems((prev) => {
        const m = new Map(prev.map((v) => [v.id, v]))
        for (const v of fresh) m.set(v.id, { ...v, seenAt: now })
        return [...m.values()].filter((v) => now - (v.seenAt ?? now) < STALE_MS)
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

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return [...items]
      .sort((a, b) => a.name.localeCompare(b.name))
      .filter((v) => !s || v.name.toLowerCase().includes(s))
  }, [items, q])

  const pick = (v) => {
    setSelId(v.id)
    setFlyTarget({ lat: v.lat, lng: v.lng, t: Date.now() })
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

  return (
    <div className="page tk-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Tracker</h1>
          <p className="page-subtitle">
            {cityName} · {items.length} vehicle{items.length === 1 ? '' : 's'} live
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
          <aside className="tk-panel">
            <div className="tk-search">
              <Search size={14} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search vehicle…"
                autoComplete="off"
              />
            </div>
            <div className="tk-list">
              {list.length === 0 ? (
                <span className="field-hint" style={{ padding: '10px 12px' }}>
                  {items.length === 0 ? 'Waiting for live positions…' : 'No match.'}
                </span>
              ) : (
                list.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className={`tk-item${selId === v.id ? ' on' : ''}`}
                    onClick={() => pick(v)}
                  >
                    <span className="tk-dot" style={{ background: colorOf(v.status) }} />
                    <span className="tk-item-main">
                      <span className="tk-item-name">{v.name || '—'}</span>
                      <span className="tk-item-sub">
                        {STATUS_LABEL[v.status] || '—'} · {Math.round(v.speed)} kph
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </aside>

          <div className="stop-map tk-map">
            <MapContainer center={FALLBACK} zoom={6} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              />
              <FitAll pts={items} />
              <FlyTo target={flyTarget} />
              {items.map((v) => (
                <Marker
                  key={v.id}
                  position={[v.lat, v.lng]}
                  icon={markerIcon(v.status, selId === v.id)}
                  zIndexOffset={selId === v.id ? 1000 : 0}
                  eventHandlers={{ click: () => pick(v) }}
                >
                  <Tooltip permanent={selId === v.id} direction="top" offset={[0, -10]}>
                    {v.name || '—'} · {Math.round(v.speed)} kph
                  </Tooltip>
                </Marker>
              ))}
            </MapContainer>
          </div>
        </div>
      )}
    </div>
  )
}
