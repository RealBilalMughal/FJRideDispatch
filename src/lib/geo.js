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
