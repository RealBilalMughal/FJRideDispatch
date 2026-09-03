import { useEffect } from 'react'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import { MapPin } from 'lucide-react'
import './stop-map.css'

// Vite serves the icon PNGs as URLs - wire them into Leaflet's default icon so
// the marker isn't a broken image. Deleting `_getIconUrl` stops Leaflet's own
// path-guessing from mangling these URLs.
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
})

const STOP_ICON = new L.Icon.Default()

// Roughly the centre of Pakistan - used only before a pin is set.
const FALLBACK = [30.3753, 69.3451]

/**
 * Free OpenStreetMap (Leaflet) map for the crew stop. `lat` / `lng` are
 * numbers | null. When `interactive`, clicking the map or dragging the pin ->
 * onChange({ lat, lng }). No API key needed.
 */
export default function StopMap({ lat, lng, onChange, interactive = true, height = 240 }) {
  const has = Number.isFinite(lat) && Number.isFinite(lng)
  const center = has ? [lat, lng] : FALLBACK

  return (
    <div className="stop-map" style={{ height }}>
      <MapContainer
        center={center}
        zoom={has ? 14 : 5}
        scrollWheelZoom
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        <FixSize />
        <Recenter has={has} lat={lat} lng={lng} />
        {interactive && <ClickToSet onChange={onChange} />}
        {has && (
          <Marker
            position={[lat, lng]}
            icon={STOP_ICON}
            draggable={interactive}
            eventHandlers={
              interactive && onChange
                ? {
                    dragend: (e) => {
                      const p = e.target.getLatLng()
                      onChange({ lat: p.lat, lng: p.lng })
                    },
                  }
                : undefined
            }
          />
        )}
      </MapContainer>
      {!has && (
        <span className="stop-map-hint">
          <MapPin size={13} /> Click the map or paste coordinates to set the stop
        </span>
      )}
    </div>
  )
}

// A Leaflet map rendered inside a modal / freshly-shown container often paints
// grey tiles until it recomputes its size. Nudge it after mount and on resize.
function FixSize() {
  const map = useMap()
  useEffect(() => {
    const fix = () => map.invalidateSize()
    const t1 = setTimeout(fix, 0)
    const t2 = setTimeout(fix, 250)
    const el = map.getContainer()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fix) : null
    ro?.observe(el)
    window.addEventListener('resize', fix)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      ro?.disconnect()
      window.removeEventListener('resize', fix)
    }
  }, [map])
  return null
}

function Recenter({ has, lat, lng }) {
  const map = useMap()
  useEffect(() => {
    if (has) map.setView([lat, lng], Math.max(map.getZoom(), 14))
  }, [has, lat, lng, map])
  return null
}

function ClickToSet({ onChange }) {
  useMapEvents({
    click: (e) => onChange?.({ lat: e.latlng.lat, lng: e.latlng.lng }),
  })
  return null
}
