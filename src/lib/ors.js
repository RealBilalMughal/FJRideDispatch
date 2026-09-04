// OpenRouteService - road distance / duration / geometry for a ride's route.
// Falls back to null (the UI then shows "—" / a straight-line preview) when the
// key is missing or the call fails.

const KEY = import.meta.env.VITE_ORS_API_KEY
const ENDPOINT = 'https://api.openrouteservice.org/v2/directions/driving-car/geojson'

// coords: [[lng, lat], ...] in visiting order (>= 2 points, all finite).
// -> { distanceKm, durationMin, line: [[lat, lng], ...] } | null
export async function routeInfo(coords) {
  const clean = (coords || []).filter(
    (c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]),
  )
  if (!KEY || clean.length < 2) return null
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: KEY, 'Content-Type': 'application/json' },
      // radiuses -1 => snap each point to the nearest road (airports / stops
      // often sit a few hundred metres off the road network).
      body: JSON.stringify({ coordinates: clean, radiuses: clean.map(() => -1) }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const feat = data?.features?.[0]
    const sum = feat?.properties?.summary
    if (!sum) return null
    const line = (feat.geometry?.coordinates || []).map(([lng, lat]) => [lat, lng])
    return {
      distanceKm: Math.round((sum.distance / 1000) * 100) / 100,
      durationMin: Math.round(sum.duration / 60),
      line,
    }
  } catch {
    return null
  }
}

// Google Maps directions URL for an ordered list of {seq, lat, lng}. No key.
export function gmapsRoute(points) {
  const pts = [...(points || [])]
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
  if (pts.length < 2) return null
  const o = pts[0]
  const d = pts[pts.length - 1]
  const mid = pts
    .slice(1, -1)
    .map((p) => `${p.lat},${p.lng}`)
    .join('|')
  let url = `https://www.google.com/maps/dir/?api=1&origin=${o.lat},${o.lng}&destination=${d.lat},${d.lng}&travelmode=driving`
  if (mid) url += `&waypoints=${encodeURIComponent(mid)}`
  return url
}
