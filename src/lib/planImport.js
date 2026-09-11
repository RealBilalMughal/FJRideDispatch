// Ride Plan CSV import: parsing, normalising and crew/vehicle/flight matching
// for the plan sheet the planning team hands over (Date/Base/Car/Ad-hoc Car/
// Block Type/Trip ID/Flight No/Origin/Destination/Start Time/End Time/
// Distance (km)/Crew Count/Crew - export it from Excel as CSV before upload,
// same as every other import in this app).
import { parseTime } from './time'

export const PLAN_REQUIRED_COLUMNS = [
  'date',
  'base',
  'car',
  'ad-hoc car',
  'block type',
  'trip id',
  'flight no',
  'origin',
  'destination',
  'start time',
  'end time',
  'distance (km)',
  'crew count',
  'crew',
]

const BLOCK_MAP = {
  deadhead: 'deadhead',
  pickup: 'pickup',
  dropoff: 'dropoff',
  return_leg: 'return_leg',
  returnleg: 'return_leg',
  'return leg': 'return_leg',
  // A deadheading crew member riding a pickup/dropoff-shaped leg with no
  // Flight No of their own - operationally a Deadhead (a repositioning, not
  // a real dispatched pickup/dropoff), just written differently in the sheet.
  'pickup-dhd-passenger': 'deadhead',
  'dropoff-dhd-passenger': 'deadhead',
}

export function normalizeBlockType(raw) {
  const key = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '')
  return BLOCK_MAP[String(raw ?? '').trim().toLowerCase()] || BLOCK_MAP[key] || null
}

// "2026-09-08" as-is; "01-09-26" / "01-09-2026" (dash, DAY first - the
// planning sheet's own format, matching this app's own DD-MMM-YY display
// convention) -> "2026-09-08"; "9/8/2026" (slash, Excel's US default when a
// CSV date cell isn't ISO-formatted - MONTH first) -> "2026-09-08". Anything
// else -> null (row skipped).
export function parsePlanDate(raw) {
  const s = String(raw ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const dash = s.match(/^(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})$/)
  if (dash) {
    const [, d, mo, yRaw] = dash
    const y = yRaw.length === 2 ? `20${yRaw}` : yRaw
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (slash) {
    const [, mo, d, y] = slash
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return null
}

// A city's Base code is its airport's first 3 letters ("LHE Airport" -> LHE),
// falling back to a fixed code->name map if a city has no airport_name set.
const BASE_TO_CITY_NAME = { LHE: 'Lahore', KHI: 'Karachi', ISB: 'Islamabad' }
export function matchCityByBase(base, allowedCities) {
  const code = String(base ?? '').trim().toUpperCase()
  if (!code) return null
  const byAirport = allowedCities.find((c) => String(c.airport_name || '').trim().toUpperCase().startsWith(code))
  if (byAirport) return byAirport.id
  const name = BASE_TO_CITY_NAME[code]
  return name ? allowedCities.find((c) => c.name === name)?.id ?? null : null
}

// "107386 Arfa IJAZ (CC), 107807 Sumaiya Arshad (CC)" -> one entry per crew
// member. A malformed/unidentified entry (no trailing "(ROLE)") is kept with
// employee_no/designation null so it still shows up for manual matching.
const CREW_ENTRY_RE = /^(\d+)\s+(.*?)\s*\((\w*)\)\s*$/
export function parseCrewCell(raw) {
  return String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const m = entry.match(CREW_ENTRY_RE)
      if (m && m[3]) return { raw: entry, employee_no: m[1], name: m[2].trim(), designation: m[3] }
      return { raw: entry, employee_no: null, name: entry, designation: null }
    })
}

const normName = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

// Tiers, best first: an exact Employee No on the crew record; an exact
// (case/space-insensitive) name match; a loose "every word of one name shows
// up in the other" fuzzy match; else unmatched - the dispatcher picks by hand.
export function matchCrewEntry(entry, crewRoster) {
  if (entry.employee_no) {
    const byNo = crewRoster.find((c) => c.employee_no === entry.employee_no)
    if (byNo) return { ...entry, crew_id: byNo.id, tier: 'employee_no' }
  }
  const target = normName(entry.name)
  const exact = crewRoster.find((c) => normName(c.name) === target)
  if (exact) return { ...entry, crew_id: exact.id, tier: 'exact_name' }
  const targetWords = target.split(' ').filter(Boolean)
  const fuzzy = crewRoster.find((c) => {
    const cWords = normName(c.name).split(' ').filter(Boolean)
    return (
      targetWords.length > 0 &&
      (targetWords.every((w) => cWords.includes(w)) || cWords.every((w) => targetWords.includes(w)))
    )
  })
  if (fuzzy) return { ...entry, crew_id: fuzzy.id, tier: 'fuzzy' }
  return { ...entry, crew_id: null, tier: 'unmatched' }
}

export function matchVehicle(car, isAdhoc, vehicles, cityId) {
  if (isAdhoc || !car) return null
  const target = String(car).trim().toLowerCase()
  return vehicles.find((v) => v.city_id === cityId && v.vehicle_no.trim().toLowerCase() === target) || null
}

// The plan sheet writes the airline code on the flight number ("9P841"); the
// Flights registry stores just the digits ("841"). Fly Jinnah's IATA code
// ("9P") starts with a DIGIT, so stripping leading letters doesn't work -
// take the trailing run of digits instead, which is the flight number either way.
const digitsOnly = (s) => String(s ?? '').trim().match(/(\d+)$/)?.[1] ?? ''
export function matchFlight(flightNo, flights, cityId) {
  const target = digitsOnly(flightNo)
  if (!target) return null
  return flights.find((f) => f.city_id === cityId && digitsOnly(f.flight_no) === target) || null
}

// records: from parseCsvObjects (headers already lower-cased/trimmed).
// Returns { ok: parsedRow[], skipped: {line, reason}[] } - `ok` rows carry a
// `line` (the CSV row number) used two ways: the import preview's unmatched-
// crew list, and - renamed to `seq` at insert time - the exact row order the
// Ride Plan page displays, since Trip ID alone doesn't reproduce the sheet's
// own sequence (see ride_plan_rows.seq).
export function buildPlanRows(records, { allowedCities, flights, crew, vehicles }) {
  const ok = []
  const skipped = []
  records.forEach((r, i) => {
    const line = i + 2 // +1 header, +1 1-based
    const plan_date = parsePlanDate(r['date'])
    if (!plan_date) return skipped.push({ line, reason: `Bad Date "${r['date']}"` })
    const block_type = normalizeBlockType(r['block type'])
    if (!block_type) return skipped.push({ line, reason: `Unknown Block Type "${r['block type']}"` })
    const city_id = matchCityByBase(r['base'], allowedCities)
    if (!city_id) return skipped.push({ line, reason: `Unknown Base "${r['base']}" - no matching city` })
    if (!String(r['trip id'] ?? '').trim()) return skipped.push({ line, reason: 'Missing Trip ID' })

    const is_adhoc_car = String(r['ad-hoc car'] ?? '').trim().toLowerCase() === 'yes'
    const car = String(r['car'] ?? '').trim() || null
    const cityCrew = crew.filter((c) => c.city_id === city_id)
    const crew_matches = parseCrewCell(r['crew']).map((e) => matchCrewEntry(e, cityCrew))
    const matchedFlight = matchFlight(r['flight no'], flights, city_id)
    const matchedVehicle = matchVehicle(car, is_adhoc_car, vehicles, city_id)
    const kmRaw = String(r['distance (km)'] ?? '').trim()
    const countRaw = String(r['crew count'] ?? '').trim()
    const planned_km = kmRaw ? Number(kmRaw) : null
    const crew_count = countRaw ? Number(countRaw) : null

    ok.push({
      line, // transient - for the import preview only, stripped before insert
      plan_date,
      city_id,
      trip_id: String(r['trip id']).trim(),
      block_type,
      car,
      is_adhoc_car,
      flight_no: String(r['flight no'] ?? '').trim() || null,
      origin: String(r['origin'] ?? '').trim() || null,
      destination: String(r['destination'] ?? '').trim() || null,
      start_time: parseTime(r['start time']),
      end_time: parseTime(r['end time']),
      planned_km: Number.isFinite(planned_km) ? planned_km : null,
      crew_count: Number.isFinite(crew_count) ? crew_count : null,
      crew_raw: String(r['crew'] ?? '').trim() || null,
      crew_matches,
      matched_flight_id: matchedFlight?.id ?? null,
      matched_vehicle_id: matchedVehicle?.id ?? null,
    })
  })
  return { ok, skipped }
}
