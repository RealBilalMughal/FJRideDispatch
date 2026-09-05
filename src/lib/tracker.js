// Live position from an AI Track sharing link - this is the same /items
// endpoint the tracker's own page polls to draw its map (confirmed CORS-open
// via Access-Control-Allow-Origin: *, and unauthenticated - the sharing
// link itself is the credential). This is an internal, undocumented
// endpoint of a third-party service, not a published API - its shape could
// change without notice; every field is read defensively.

function itemsUrl(shareUrl) {
  try {
    const u = new URL(shareUrl)
    return `${u.origin}${u.pathname.replace(/\/$/, '')}/items?time=0&_=${Date.now()}`
  } catch {
    return null
  }
}

// -> { lat, lng, speed (kph), course (deg), status, timestamp, address } | null
export async function fetchLiveTracker(shareUrl) {
  const url = itemsUrl(shareUrl)
  if (!url) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    const item = data?.items?.[0]
    const lat = Number(item?.lat)
    const lng = Number(item?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return {
      lat,
      lng,
      speed: Number(item.speed) || 0,
      course: Number(item.course) || 0,
      // icon_color: 'green' moving / 'red' stopped / 'blue' offline / 'yellow' engine-on
      status: item.icon_color || 'offline',
      timestamp: item.timestamp ?? null,
      address: item.addr || '',
    }
  } catch {
    return null
  }
}
