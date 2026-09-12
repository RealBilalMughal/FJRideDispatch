import { useEffect } from 'react'
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { distanceMeters } from '../lib/geo'
import './stop-map.css'

const FALLBACK = [30.3753, 69.3451]

// stop role -> colour. origin (pickup point) green, destination (drop) red,
// every stop in between amber.
const STOP_COLOR = { origin: '#1e874b', mid: '#b7791f', dest: '#c0392b' }
const stopIcon = (role, badge) =>
  L.divIcon({
    className: 'rm-pin-wrap',
    html: `<span class="rm-pin" style="background:${STOP_COLOR[role] || '#3471b8'}">${badge}</span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  })

// live tracker's icon_color -> a dot colour (moving/stopped/offline/engine-on)
const LIVE_COLOR = { green: '#1e874b', red: '#c0392b', blue: '#0e7490', yellow: '#b7791f' }
const liveIcon = (status) => {
  const color = LIVE_COLOR[status] || '#727272'
  return L.divIcon({
    className: 'rm-live-wrap',
    html: `<span class="rm-live" style="--rm-live:${color}"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  })
}

// cumulative straight-line distance (km) at each point, scaled so the last one
// equals `totalKm` when that's known (turns rough crow-flies legs into numbers
// that add up to the real road total).
function cumulativeKm(pts, totalKm) {
  const legs = []
  for (let i = 1; i < pts.length; i++) {
    legs.push(distanceMeters(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng) / 1000)
  }
  const straight = legs.reduce((a, b) => a + b, 0)
  const scale = totalKm && straight > 0 ? totalKm / straight : 1
  const cum = [0]
  for (const l of legs) cum.push(cum[cum.length - 1] + l * scale)
  return cum
}

/**
 * Read-only route preview. `points` is the ordered stop list
 * [{ seq, label, crew_name?, lat, lng }] - `label` is the stop's name,
 * `crew_name` (when present) is shown alongside it on the pin so a
 * dispatcher can see WHO a stop belongs to without cross-referencing the
 * crew list. `line` is the road geometry [[lat,lng], ...] from
 * ORS - when absent it draws straight segments between the points.
 * `totalKm` (optional) labels each stop with the running distance from the
 * origin, scaled to this total. `liveMarker` (optional) is a vehicle's current
 * tracker fix - `{ lat, lng, speed, status }` (see `src/lib/tracker.js`) -
 * drawn as a pulsing dot. `actualPath` (optional, [[lat,lng],...]) is the
 * recorded GPS trip (AI Tracker), drawn dashed purple; `playMarker` is a
 * `{ lat, lng }` position for the playback scrubber.
 */
export default function RouteMap({
  points = [],
  line,
  totalKm,
  liveMarker,
  actualPath,
  playMarker,
  height = 220,
}) {
  const pts = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
  const path = line && line.length > 1 ? line : pts.map((p) => [p.lat, p.lng])
  const center = pts[0] ? [pts[0].lat, pts[0].lng] : FALLBACK
  const extra = []
  if (liveMarker) extra.push([liveMarker.lat, liveMarker.lng])
  if (actualPath && actualPath.length) extra.push(...actualPath)
  const fitPath = extra.length ? [...path, ...extra] : path
  const cum = cumulativeKm(pts, totalKm)

  return (
    <div className="stop-map" style={{ height }}>
      <MapContainer center={center} zoom={11} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        <Fit path={fitPath} />
        {path.length > 1 && <Polyline positions={path} pathOptions={{ color: '#3471b8', weight: 4 }} />}
        {actualPath && actualPath.length > 1 && (
          <Polyline
            positions={actualPath}
            pathOptions={{ color: '#8b5cf6', weight: 3, dashArray: '6 6', opacity: 0.9 }}
          />
        )}
        {playMarker && Number.isFinite(playMarker.lat) && (
          <Marker
            position={[playMarker.lat, playMarker.lng]}
            icon={liveIcon('yellow')}
            zIndexOffset={1100}
          />
        )}
        {pts.map((p, i) => {
          const role = i === 0 ? 'origin' : i === pts.length - 1 ? 'dest' : 'mid'
          const badge = i === 0 ? 'A' : i === pts.length - 1 ? 'B' : String(i)
          const kmLabel = cum[i] != null ? ` · ${cum[i].toFixed(1)} km` : ''
          return (
            <Marker
              key={`${p.seq ?? i}-${p.lat}-${p.lng}`}
              position={[p.lat, p.lng]}
              icon={stopIcon(role, badge)}
            >
              <Tooltip permanent direction="top" offset={[0, -14]}>
                {badge}
                {p.crew_name ? ` · ${p.crew_name}` : ''}
                {p.label && p.label !== p.crew_name ? ` · ${p.label}` : ''}
                {kmLabel}
              </Tooltip>
            </Marker>
          )
        })}
        {liveMarker && (
          <Marker position={[liveMarker.lat, liveMarker.lng]} icon={liveIcon(liveMarker.status)} zIndexOffset={1000}>
            <Tooltip>
              {Math.round(liveMarker.speed)} kph{liveMarker.address ? ` · ${liveMarker.address}` : ''}
            </Tooltip>
          </Marker>
        )}
      </MapContainer>
      {pts.length < 2 && (
        <span className="stop-map-hint">Pick a block + crew to see the route</span>
      )}
    </div>
  )
}

function Fit({ path }) {
  const map = useMap()
  useEffect(() => {
    const t1 = setTimeout(() => map.invalidateSize(), 0)
    const t2 = setTimeout(() => {
      map.invalidateSize()
      if (path && path.length > 1) {
        try {
          map.fitBounds(L.latLngBounds(path).pad(0.2))
        } catch {
          /* ignore */
        }
      }
    }, 200)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [map, path])
  return null
}
