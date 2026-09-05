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

// A Return Leg / Deadhead repositions crew, it isn't a passenger pickup or
// drop-off, so its crew count always DISPLAYS 0 - table, CSV export, the
// ride view, and the dashboard "crew moved" total - forced, not derived from
// how many ride_crew rows it happens to carry.
export const ZERO_COUNT_BLOCKS = new Set(['return_leg', 'deadhead'])
export const displayCrewCount = (rideCrew, block) =>
  ZERO_COUNT_BLOCKS.has(block) ? 0 : (rideCrew || []).length

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
  // origin / destination / layover labels show the STOP name, not the crew name
  label: c.stop_name || c.name || 'Crew stop',
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

// what to call the ride's start-time field, by block
export const rideTimeLabel = (block) =>
  block === 'pickup' ? 'Pickup Time' : block === 'dropoff' ? 'Drop Time' : 'Ride Time'

// Default Check-in / Check-out buffer minutes (per-city override lives on
// cities.checkin_buffer_min / checkout_buffer_min, edited at
// Settings -> Ride Buffer Time). Used as the fallback until a city record
// loads.
//   Pickup Time = Check-in (Actual if set) - checkin buffer - drive time
//   Drop Time   = Check-out (Actual if set) + checkout buffer
export const DEFAULT_CHECKIN_BUFFER_MIN = 90
export const DEFAULT_CHECKOUT_BUFFER_MIN = 30

// Return Leg Ride Time = the original dropoff ride's arrival at the crew
// stop (its ETA = start_at + duration_min) + this buffer. Per-city override
// on cities.return_leg_buffer_min.
export const DEFAULT_RETURN_LEG_BUFFER_MIN = 10

// Deadhead Ride Time (from "Create Ride" on a dropoff ride) = that same
// dropoff ride's ETA + this buffer - same formula, its own per-city override
// on cities.deadhead_buffer_min.
export const DEFAULT_DEADHEAD_BUFFER_MIN = 15

// Per-crew wait: a pickup / dropoff that visits more than one crew stop waits
// at each stop AFTER the first for crew to board / alight. Total extra minutes
// = (crewCount - 1) * buffer - folded into the ride's duration_min so ETA,
// end_at and the Pickup-Time auto-suggest all account for it. Per-city
// override on cities.crew_wait_buffer_min.
export const DEFAULT_CREW_WAIT_BUFFER_MIN = 5
export const crewWaitMinutes = (block, crewCount, buffer = DEFAULT_CREW_WAIT_BUFFER_MIN) => {
  const n = Number(crewCount) || 0
  const b = Number.isFinite(Number(buffer)) ? Number(buffer) : DEFAULT_CREW_WAIT_BUFFER_MIN
  return (block === 'pickup' || block === 'dropoff') && n > 1 ? (n - 1) * b : 0
}

export const RIDE_STATUS = ['scheduled', 'dispatched', 'enroute', 'completed', 'cancelled']
export const statusLabel = (s) =>
  ({ scheduled: 'Scheduled', dispatched: 'Dispatched', enroute: 'En route', completed: 'Completed', cancelled: 'Cancelled' })[s] || s
