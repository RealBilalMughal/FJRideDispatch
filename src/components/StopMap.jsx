import { Component, useEffect, useState } from 'react'
import { APIProvider, AdvancedMarker, Map } from '@vis.gl/react-google-maps'
import { MapPin } from 'lucide-react'
import './stop-map.css'

const KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
// Google's public map id for development (needed by AdvancedMarker).
const MAP_ID = 'DEMO_MAP_ID'
// Roughly the centre of Pakistan - used only before a pin is set.
const FALLBACK = { lat: 30.3753, lng: 69.3451 }

function Hint({ height, children }) {
  return (
    <div className="stop-map placeholder" style={{ height }}>
      <MapPin size={18} />
      {children}
    </div>
  )
}

// A map failure (bad key, blocked API, SDK change) must never white-screen the page.
class MapBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(err) {
    // eslint-disable-next-line no-console
    console.warn('StopMap disabled:', err)
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/**
 * Shows the crew stop on a Google map. `lat` / `lng` are numbers | null.
 * When `interactive`, clicking the map or dragging the pin -> onChange({ lat, lng }).
 * Degrades to a hint box with no key, or if the Maps SDK errors out.
 */
export default function StopMap({ lat, lng, onChange, interactive = true, height = 240 }) {
  const has = Number.isFinite(lat) && Number.isFinite(lng)
  const pinText = has ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : 'No location set'

  if (!KEY) {
    return (
      <Hint height={height}>
        <span>{has ? `Pin: ${pinText}` : pinText}</span>
        <small>Add VITE_GOOGLE_MAPS_API_KEY to show the map.</small>
      </Hint>
    )
  }

  const fallback = (
    <Hint height={height}>
      <span>{has ? `Pin: ${pinText}` : pinText}</span>
      <small>Map unavailable — check the Google Maps API key restrictions.</small>
    </Hint>
  )

  return (
    <MapBoundary fallback={fallback}>
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
    </MapBoundary>
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
    if (Number.isFinite(a) && Number.isFinite(b)) onChange({ lat: a, lng: b })
  }

  return (
    <Map
      mapId={MAP_ID}
      defaultZoom={has ? 14 : 6}
      center={center}
      onCenterChanged={(e) => setCenter(e.detail.center)}
      gestureHandling="greedy"
      onClick={(e) => pick(e.detail?.latLng)}
    >
      {has && (
        <AdvancedMarker
          position={{ lat, lng }}
          draggable={interactive}
          onDragEnd={(e) => pick(e.latLng)}
        />
      )}
    </Map>
  )
}
