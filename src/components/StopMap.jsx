import { useCallback, useEffect, useRef, useState } from 'react'
import { APIProvider, Map, useMap, useMapsLibrary } from '@vis.gl/react-google-maps'
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
        <MapInner value={has ? value : null} onChange={onChange} />
      </APIProvider>
    </div>
  )
}

function MapInner({ value, onChange }) {
  const [center, setCenter] = useState(value ?? FALLBACK)

  useEffect(() => {
    if (value) setCenter(value)
  }, [value])

  const pick = useCallback(
    (latLng) => {
      if (!latLng) return
      const lat = typeof latLng.lat === 'function' ? latLng.lat() : latLng.lat
      const lng = typeof latLng.lng === 'function' ? latLng.lng() : latLng.lng
      onChange({ lat, lng })
    },
    [onChange],
  )

  return (
    <Map
      defaultZoom={value ? 14 : 6}
      center={center}
      onCenterChanged={(e) => setCenter(e.detail.center)}
      gestureHandling="greedy"
      onClick={(e) => pick(e.detail?.latLng)}
    >
      <StopMarker position={value} onPick={pick} />
    </Map>
  )
}

// Imperative marker with a real cleanup - avoids the <Marker> component's
// IntersectionObserver churn under React 19 StrictMode.
function StopMarker({ position, onPick }) {
  const map = useMap()
  const mapsLib = useMapsLibrary('maps')
  const pickRef = useRef(onPick)
  pickRef.current = onPick

  useEffect(() => {
    if (!map || !mapsLib || !position) return
    const marker = new mapsLib.Marker({ map, position, draggable: true })
    const listener = marker.addListener('dragend', (e) => pickRef.current(e.latLng))
    return () => {
      listener.remove()
      marker.setMap(null)
    }
  }, [map, mapsLib, position?.lat, position?.lng])

  return null
}
