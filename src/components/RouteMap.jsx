import { useEffect } from 'react'
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import './stop-map.css'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
})
const ICON = new L.Icon.Default()

const FALLBACK = [30.3753, 69.3451]

/**
 * Read-only route preview. `points` is the ordered stop list
 * [{ seq, label, lat, lng }]. `line` is the road geometry [[lat,lng], ...] from
 * ORS - when absent it draws straight segments between the points.
 */
export default function RouteMap({ points = [], line, height = 220 }) {
  const pts = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
  const path = line && line.length > 1 ? line : pts.map((p) => [p.lat, p.lng])
  const center = pts[0] ? [pts[0].lat, pts[0].lng] : FALLBACK

  return (
    <div className="stop-map" style={{ height }}>
      <MapContainer center={center} zoom={11} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        <Fit path={path} />
        {path.length > 1 && <Polyline positions={path} pathOptions={{ color: '#3471b8', weight: 4 }} />}
        {pts.map((p, i) => (
          <Marker key={`${p.seq ?? i}-${p.lat}-${p.lng}`} position={[p.lat, p.lng]} icon={ICON}>
            <Tooltip permanent direction="top" offset={[0, -34]}>
              {i === 0 ? 'A' : i === pts.length - 1 ? 'B' : i}
              {p.label ? ` · ${p.label}` : ''}
            </Tooltip>
          </Marker>
        ))}
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
