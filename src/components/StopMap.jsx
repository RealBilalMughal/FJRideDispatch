import { useEffect, useState } from 'react'
import { APIProvider, Map, Marker } from '@vis.gl/react-google-maps'
import { MapPin } from 'lucide-react'
import './stop-map.css'

const KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
// Roughly the centre of Pakistan - used only before a pin is set.
const FALLBACK = { lat: 30.3753, lng: 69.3451 }

/**
 * Shows the crew stop on a Google map. `value` is { lat, lng } | null.
 * Click the map or drag the pin -> onChange({ lat, lng }).
 * With no VITE_GOOGLE_MAPS_API_KEY it degrades to a hint box (the coordinate
 * field in the form still works).
 */
export default function StopMap({ value, onChange, height = 240 }) {
  const has = value && Number.isFinite(value.lat) && Number.isFinite(value.lng)

  if (!KEY) {
    return (
      <div className="stop-map placeholder" style={{ height }}>
        <MapPin size={18} />
        <span>
          {has ? `Pin: ${value.lat.toFixed(6)}, ${value.lng.toFixed(6)}` : 'No location set'}
        </span>
        <small>Add VITE_GOOGLE_MAPS_API_KEY to show the map.</small>
      </div>
    )
  }

  return (
    <div className="stop-map" style={{ height }}>
      <APIProvider apiKey={KEY}>
        <MapInner value={value} has={has} onChange={onChange} />
      </APIProvider>
    </div>
  )
}

function MapInner({ value, has, onChange }) {
  const [center, setCenter] = useState(has ? value : FALLBACK)

  useEffect(() => {
    if (has) setCenter(value)
  }, [has, value])

  const pick = (latLng) => {
    if (!latLng) return
    const lat = typeof latLng.lat === 'function' ? latLng.lat() : latLng.lat
    const lng = typeof latLng.lng === 'function' ? latLng.lng() : latLng.lng
    onChange({ lat, lng })
  }

  return (
    <Map
      defaultZoom={has ? 14 : 6}
      center={center}
      onCenterChanged={(e) => setCenter(e.detail.center)}
      gestureHandling="greedy"
      disableDefaultUI={false}
      onClick={(e) => pick(e.detail?.latLng)}
    >
      {has && (
        <Marker
          position={value}
          draggable
          onDragEnd={(e) => pick(e.latLng)}
        />
      )}
    </Map>
  )
}
