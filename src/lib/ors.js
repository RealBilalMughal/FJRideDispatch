// OpenRouteService - road distance / duration / geometry for a ride's route.
// Falls back to null (the UI then shows "—" / a straight-line preview) when the
// key is missing or the call fails.

const KEY = import.meta.env.VITE_ORS_API_KEY
const ENDPOINT = 'https://api.openrouteservice.org/v2/directions/driving-car/geojson'

// Session cache: the same ordered coordinate list only ever hits ORS once per
// page load (keyed on the coords rounded to ~1 m). Value is the in-flight
// Promise first - so concurrent callers share one request - then the resolved
// result. Failures are NOT cached (so a later retry can succeed). This is what
// keeps re-opening / re-editing a ride, or a Generate run over one flight, from
// burning API credits: the rounded key matches even across component remounts.
const routeCache = new Map()
const coordKey = (coords) => coords.map((c) => `${c[0].toFixed(5)},${c[1].toFixed(5)}`).join(';')

async function fetchRoute(clean) {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: KEY, 'Content-Type': 'application/json' },
      // radiuses -1 => snap each point to the nearest road (airports / stops
      // often sit a few hundred metres off the road network).
      // preference 'fastest' (ORS defaults to 'recommended' when omitted,
      // which favours road quality/distance and can route onto slower local
      // roads even where a highway is available) - biases toward
      // motorways/highways the way a real driver (and Google Maps) would,
      // which is also usually the longer-but-faster route in km terms.
      body: JSON.stringify({
        coordinates: clean,
        radiuses: clean.map(() => -1),
        preference: 'fastest',
      }),
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

// coords: [[lng, lat], ...] in visiting order (>= 2 points, all finite).
// -> { distanceKm, durationMin, line: [[lat, lng], ...] } | null
export async function routeInfo(coords) {
  const clean = (coords || []).filter(
    (c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]),
  )
  if (!KEY || clean.length < 2) return null
  const key = coordKey(clean)
  if (routeCache.has(key)) return routeCache.get(key)
  const p = fetchRoute(clean)
  routeCache.set(key, p)
  const result = await p
  if (result == null) routeCache.delete(key)
  else routeCache.set(key, result)
  return result
}

// Reorder the crew stops for the shortest total drive (ORS optimization / Vroom).
// `crewCoords`: [{ id, lat, lng }] ; `airport`: { lat, lng }.
// pickup  -> vehicle ends at the airport ; dropoff -> vehicle starts at it.
// Returns the reordered array of crew ids, or null (unchanged / can't optimise).
export async function optimizeCrewOrder(block, crewCoords, airport) {
  const cc = (crewCoords || []).filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng))
  if (!KEY || cc.length < 3 || !Number.isFinite(airport?.lat)) return null
  if (block !== 'pickup' && block !== 'dropoff') return null
  const vehicle = { id: 1, profile: 'driving-car' }
  if (block === 'pickup') vehicle.end = [airport.lng, airport.lat]
  else vehicle.start = [airport.lng, airport.lat]
  try {
    const res = await fetch('https://api.openrouteservice.org/optimization', {
      method: 'POST',
      headers: { Authorization: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobs: cc.map((c, i) => ({ id: i + 1, location: [c.lng, c.lat] })),
        vehicles: [vehicle],
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const steps = (data?.routes?.[0]?.steps || []).filter((s) => s.type === 'job')
    if (steps.length !== cc.length) return null
    return steps.map((s) => cc[s.id - 1].id)
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
