// "31.9279, 74.9738" (or "31.9279 74.9738" / "lat: 31.9, lng: 74.9") -> { lat, lng }
// Returns null if it can't parse a sane lat/lng pair.
export function parseLatLng(text) {
  if (text == null) return null
  const nums = String(text)
    .replace(/[^\d.,\-\s]/g, ' ')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n))
  if (nums.length < 2) return null
  const [lat, lng] = nums
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng }
}

export function fmtLatLng(lat, lng) {
  if (lat == null || lng == null || lat === '' || lng === '') return ''
  const a = Number(lat)
  const b = Number(lng)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return ''
  return `${a.toFixed(6)}, ${b.toFixed(6)}`
}

// Great-circle distance in meters (haversine).
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// Point-to-segment distance in meters, via a local equirectangular
// projection around the segment's midpoint - accurate enough for
// ride-length (city-scale) segments, much cheaper than true geodesic math.
function distanceToSegmentMeters(lat, lng, lat1, lng1, lat2, lng2) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const latRef = toRad((lat1 + lat2) / 2)
  const x = (lng - lng1) * Math.cos(latRef) * toRad(1) * R
  const y = (lat - lat1) * toRad(1) * R
  const x2 = (lng2 - lng1) * Math.cos(latRef) * toRad(1) * R
  const y2 = (lat2 - lat1) * toRad(1) * R
  const lenSq = x2 * x2 + y2 * y2
  const t = lenSq ? Math.max(0, Math.min(1, (x * x2 + y * y2) / lenSq)) : 0
  return Math.hypot(x - x2 * t, y - y2 * t)
}

// Shortest distance (meters) from a point to a polyline [[lat,lng], ...].
export function distanceToLineMeters(lat, lng, line) {
  if (!line || line.length < 2) return Infinity
  let min = Infinity
  for (let i = 0; i < line.length - 1; i++) {
    const d = distanceToSegmentMeters(lat, lng, line[i][0], line[i][1], line[i + 1][0], line[i + 1][1])
    if (d < min) min = d
  }
  return min
}
