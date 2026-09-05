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

// one /items entry -> our shape, or null if it has no usable position
function normItem(it) {
  const lat = Number(it?.lat)
  const lng = Number(it?.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return {
    id: it.id ?? `${it.name}-${lat}-${lng}`,
    name: it.name || '',
    lat,
    lng,
    speed: Number(it.speed) || 0,
    course: Number(it.course) || 0,
    // icon_color: 'green' moving / 'red' stopped / 'blue' offline / 'yellow' engine-on
    status: it.icon_color || 'offline',
    timestamp: it.timestamp ?? null,
    address: it.addr || '',
  }
}

// a per-vehicle sharing link -> that one vehicle's live fix | null
export async function fetchLiveTracker(shareUrl) {
  const url = itemsUrl(shareUrl)
  if (!url) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    return normItem(data?.items?.[0])
  } catch {
    return null
  }
}

// a fleet (or per-vehicle) sharing link -> every vehicle it exposes
export async function fetchFleetTracker(shareUrl) {
  const url = itemsUrl(shareUrl)
  if (!url) return []
  try {
    const res = await fetch(url)
    if (!res.ok) return []
    const data = await res.json()
    return (data?.items || []).map(normItem).filter(Boolean)
  } catch {
    return []
  }
}
