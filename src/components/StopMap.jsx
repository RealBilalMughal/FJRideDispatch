import { useEffect, useRef, useState } from 'react'
import { APIProvider, Map, useMap, useMapsLibrary } from '@vis.gl/react-google-maps'
import { MapPin } from 'lucide-react'
import './stop-map.css'

const KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
// Roughly the centre of Pakistan - used only before a pin is set.
const FALLBACK = { lat: 30.3753, lng: 69.3451 }

/**
 * Shows the crew stop on a Google map. `lat` / `lng` are numbers | null.
 * When `interactive`, clicking the map or dragging the pin -> onChange({ lat, lng }).
 * With no VITE_GOOGLE_MAPS_API_KEY it degrades to a hint box (the coordinate
 * field in the form still works).
 */
export default function StopMap({ lat, lng, onChange, interactive = true, height = 240 }) {
  const has = Number.isFinite(lat) && Number.isFinite(lng)

  if (!KEY) {
    return (
      <div className="stop-map placeholder" style={{ height }}>
        <MapPin size={18} />
        <span>{has ? `Pin: ${lat.toFixed(6)}, ${lng.toFixed(6)}` : 'No location set'}</span>
        <small>Add VITE_GOOGLE_MAPS_API_KEY to show the map.</small>
      </div>
    )
  }

  return (
    <div className="stop-map" style={{ height }}>
      <APIProvider apiKey={KEY}>
        <MapInner
          lat={has ? lat : null}
          lng={has ? lng : null}
          onChange={onChange}
          interactive={interactive}
        />
      </APIProvider>
    </div>
  )
}

function MapInner({ lat, lng, onChange, interactive }) {
  const has = lat != null && lng != null
  const [center, setCenter] = useState(has ? { lat, lng } : FALLBACK)

  // primitive deps - never loops even if the parent recreates objects each render
  useEffect(() => {
    if (has) setCenter({ lat, lng })
  }, [has, lat, lng])

  const pick = (latLng) => {
    if (!interactive || !latLng || !onChange) return
    const a = typeof latLng.lat === 'function' ? latLng.lat() : latLng.lat
    const b = typeof latLng.lng === 'function' ? latLng.lng() : latLng.lng
    onChange({ lat: a, lng: b })
  }

  return (
    <Map
      defaultZoom={has ? 14 : 6}
      center={center}
      onCenterChanged={(e) => setCenter(e.detail.center)}
      gestureHandling="greedy"
      onClick={(e) => pick(e.detail?.latLng)}
    >
      <StopMarker lat={has ? lat : null} lng={has ? lng : null} draggable={interactive} onPick={pick} />
    </Map>
  )
}

// Imperative marker with real cleanup - avoids the <Marker> component's
// IntersectionObserver churn under React 19 StrictMode.
function StopMarker({ lat, lng, draggable, onPick }) {
  const map = useMap()
  const mapsLib = useMapsLibrary('maps')
  const pickRef = useRef(onPick)
  pickRef.current = onPick

  useEffect(() => {
    if (!map || !mapsLib || lat == null || lng == null) return
    const marker = new mapsLib.Marker({ map, position: { lat, lng }, draggable })
    const listener = draggable ? marker.addListener('dragend', (e) => pickRef.current(e.latLng)) : null
    return () => {
      listener?.remove()
      marker.setMap(null)
    }
  }, [map, mapsLib, lat, lng, draggable])

  return null
}
