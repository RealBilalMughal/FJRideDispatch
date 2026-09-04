// Ride route logic - block-wise ordering of stops.
//
//   pickup      crew1 -> crew2 -> ... -> crewN -> Airport   (origin = crew1)
//   dropoff     Airport -> crew1 -> ... -> crewN            (origin = Airport)
//   deadhead    'airport': Airport -> 1 crew  |  'crew': crew1 -> crew2
//   return_leg  1 crew -> Airport

export const BLOCK_TYPES = [
  { value: 'deadhead', label: 'Deadhead' },
  { value: 'pickup', label: 'Pickup' },
  { value: 'dropoff', label: 'Drop Off' },
  { value: 'return_leg', label: 'Return leg' },
]
export const blockLabel = (v) => BLOCK_TYPES.find((b) => b.value === v)?.label || (v ? v : '—')

// how many crew the block needs: { min, max } (max null = unlimited)
export function crewRule(block, deadheadMode) {
  if (block === 'pickup' || block === 'dropoff') return { min: 1, max: null }
  if (block === 'return_leg') return { min: 1, max: 1 }
  if (block === 'deadhead') return deadheadMode === 'crew' ? { min: 2, max: 2 } : { min: 1, max: 1 }
  return { min: 0, max: null }
}

const n = (v) => (v == null || v === '' ? NaN : Number(v))
const crewPoint = (c) => ({
  kind: 'crew',
  crew_id: c.crew_id ?? c.id,
  label: `${c.name}${c.stop_name ? ' · ' + c.stop_name : ''}`,
  lat: n(c.stop_lat),
  lng: n(c.stop_lng),
})

// crewList: ordered [{ id/crew_id, name, stop_name, stop_lat, stop_lng }]
// airport:  { name, lat, lng }
// -> ordered [{ seq, kind, crew_id?, label, lat, lng }]
export function buildRoutePoints(block, deadheadMode, crewList = [], airport = {}) {
  const A = {
    kind: 'airport',
    label: airport.name || 'Airport',
    lat: n(airport.lat),
    lng: n(airport.lng),
  }
  let pts = []
  if (block === 'pickup') pts = [...crewList.map(crewPoint), A]
  else if (block === 'dropoff') pts = [A, ...crewList.map(crewPoint)]
  else if (block === 'return_leg') pts = crewList[0] ? [crewPoint(crewList[0]), A] : []
  else if (block === 'deadhead') {
    if (deadheadMode === 'crew') {
      pts = crewList[0] && crewList[1] ? [crewPoint(crewList[0]), crewPoint(crewList[1])] : []
    } else {
      pts = crewList[0] ? [A, crewPoint(crewList[0])] : []
    }
  }
  return pts.map((p, i) => ({ ...p, seq: i }))
}

export const routeComplete = (pts) =>
  pts.length >= 2 && pts.every((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))

// which flight-time slot this block fills
export const primaryTimeSlot = (block) =>
  block === 'pickup' ? 'checkin' : block === 'dropoff' ? 'checkout' : null

export const RIDE_STATUS = ['scheduled', 'dispatched', 'enroute', 'completed', 'cancelled']
export const statusLabel = (s) =>
  ({ scheduled: 'Scheduled', dispatched: 'Dispatched', enroute: 'En route', completed: 'Completed', cancelled: 'Cancelled' })[s] || s
