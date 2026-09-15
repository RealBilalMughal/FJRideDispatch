import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Ban, ChevronLeft, ChevronRight, Download, Eye, MessageSquare, Navigation, Plus, RefreshCw, Sigma, Trash2, Upload, UserPlus, XCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { useCity } from '../context/useCity'
import { fmtDate } from '../lib/format'
import { addDays, fmtTime12, pkNow, pkToday } from '../lib/time'
import { blockLabel, displayCrewCount } from '../lib/rideRoute'
import { gmapsRoute } from '../lib/ors'
import { checkHeaders, downloadCsv, parseCsvObjects, toCsv } from '../lib/csv'
import { PLAN_REQUIRED_COLUMNS, buildPlanInitial, buildPlanRows } from '../lib/planImport'
import Modal from '../components/Modal'
import ConfirmDelete from '../components/ConfirmDelete'
import DataTable from '../components/data/DataTable'
import StatCards from '../components/data/StatCards'
import SearchSelect from '../components/SearchSelect'
import { RideModal } from './Rides'
import '../components/data/data.css'
import './RidePlan.css'

// Fixed order for the top KM summary - not the insertion order rows happen
// to appear in.
const SUMMARY_BLOCKS = ['deadhead', 'pickup', 'dropoff', 'return_leg']

// Full ride select - same shape RideModal expects (same as Rides.jsx SELECT).
const RIDE_SELECT = `
  id, ref_no, city_id, flight_id, flight_no, flight_code, block_type, deadhead_mode,
  ride_date, duty_sheet_date, checkin_old, checkin_new, checkout_old, checkout_new, start_at, end_at,
  vehicle_id, driver_id, is_adhoc_vehicle, adhoc_vehicle_no, adhoc_driver_name, adhoc_driver_phone,
  airport_name, airport_lat, airport_lng,
  origin_label, origin_lat, origin_lng, dest_label, dest_lat, dest_lng,
  waypoints, route_geometry, distance_km, extra_km, duration_min, status, shift, return_of_ride_id, notes, created_at,
  cancel_reason, cancelled_at, count_km,
  city:cities(name),
  vehicle:vehicles(ref_no, vehicle_no, tracker_url),
  driver:drivers!rides_driver_id_fkey(ref_no, name),
  ride_crew(seq, crew:crew(id, ref_no, name, stop_name, stop_lat, stop_lng))
`

const SAMPLE_COLS = PLAN_REQUIRED_COLUMNS.map((key) => ({ key, label: key }))
const SAMPLE = [
  {
    date: '2026-09-08',
    base: 'LHE',
    car: 'AUK-980',
    'ad-hoc car': 'No',
    'block type': 'deadhead',
    'trip id': '2026-09-08_1',
    'flight no': '',
    origin: '',
    destination: '',
    'start time': '05:00',
    'end time': '05:39',
    'distance (km)': '26.9',
    'crew count': '',
    crew: '',
  },
  {
    date: '2026-09-08',
    base: 'LHE',
    car: 'AUK-980',
    'ad-hoc car': 'No',
    'block type': 'pickup',
    'trip id': '2026-09-08_1',
    'flight no': '9P841',
    origin: 'LHE',
    destination: 'KHI',
    'start time': '05:39',
    'end time': '06:30',
    'distance (km)': '33.8',
    'crew count': '3',
    crew: '107386 Arfa IJAZ (CC), 107807 Sumaiya Arshad (CC), 104718 Zamar SHAFIQUE (CS)',
  },
]

// A followed row's actual KM, same "cancelled and not counted -> 0" rule the
// Rides page and Dashboard use for every other KM total.
const billableKm = (ride) => {
  if (!ride) return null
  if (ride.status === 'cancelled' && !ride.count_km) return 0
  return ride.distance_km
}

const tierText = (tier) =>
  tier === 'employee_no' || tier === 'exact_name' ? '' : tier === 'fuzzy' ? ' · fuzzy match' : ' · unmatched'
const tierClass = (tier) => (tier === 'unmatched' ? 'bad' : tier === 'fuzzy' ? 'off' : '')

// A followed Pickup/Dropoff whose dispatched ride ended up with a different
// crew count than the plan (e.g. plan had 2, only 1 was actually added).
// Never applies to a synthetic "extra ride" row - there was no plan to
// mismatch against.
const hasCrewMismatch = (row) =>
  !row.isExtra &&
  row.status === 'followed' &&
  (row.block_type === 'pickup' || row.block_type === 'dropoff') &&
  row.actualCrewCount != null &&
  row.actualCrewCount !== (row.crew_matches || []).length

// ISO timestamp -> "HH:MM" (24h, browser-local) - matches the plain 24h
// strings `ride_plan_rows.start_time`/`end_time` already carry, so a
// synthetic extra-ride row can reuse the same "time" column render as a
// real plan row.
const isoHHMM = (iso) => {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function CrewMatchCell({ row, crew, onDispatchCrew, extraCrewSet }) {
  const matches = row.crew_matches
  if (!matches?.length) return <span className="secondary">—</span>
  const showIcons = Boolean(onDispatchCrew && hasCrewMismatch(row))
  const actualSet = showIcons ? new Set(row.actualCrewNames ?? []) : null
  return (
    <div className="crew-cell-stack">
      {matches.map((m, i) => {
        const c = crew.find((x) => x.id === m.crew_id)
        const name = c?.name || m.name
        // Hide icon if crew is in the linked ride OR in any extra child ride
        const isUnserved = showIcons && c && !actualSet.has(name) && !extraCrewSet?.has(name)
        return (
          <div key={i} className="rp-crew-row">
            <span>{name}</span>
            {tierText(m.tier) && <span className={`status-text ${tierClass(m.tier)}`}>{tierText(m.tier)}</span>}
            {isUnserved && (
              <button
                type="button"
                className="icon-btn rp-crew-dispatch-btn"
                title={`Open Add Ride for ${name}`}
                onClick={() => onDispatchCrew(row.id, m.crew_id)}
              >
                <UserPlus size={12} />
              </button>
            )}
          </div>
        )
      })}
      {hasCrewMismatch(row) && (
        <div className="status-text bad">
          Actual: {row.actualCrewCount} of {matches.length} planned
        </div>
      )}
    </div>
  )
}

function StatusCell({ row }) {
  if (row.isExtra)
    return (
      <div className="crew-cell-stack">
        <span className="status-text off">Extra ride</span>
        {row.ride && <span className="secondary">{row.displayRef ?? row.ride.ref_no}</span>}
      </div>
    )
  if (row.status === 'followed')
    return (
      <div className="crew-cell-stack">
        <span className={`status-text ${row.via_no ? 'bad' : 'on'}`}>{row.via_no ? 'No Follow' : 'Followed'}</span>
        {row.ride && <span className="secondary">{row.displayRef ?? row.ride.ref_no}</span>}
      </div>
    )
  if (row.status === 'skipped')
    return (
      <span className="rp-status-cancelled" title={row.skip_reason || ''}>
        Cancelled
      </span>
    )
  return <span className="status-text off">Pending</span>
}

export default function RidePlan() {
  const { can, profile } = useAuth()
  const { allowedCities, cityId, cityName } = useCity()

  const canView = can('ride_plan', 'view')
  const canAdd = can('ride_plan', 'add')
  const canEdit = can('ride_plan', 'edit')
  const canDelete = can('ride_plan', 'delete')
  const canAddRide = can('rides', 'add')

  const [planDate, setPlanDate] = useState(pkToday())
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  // Live Pakistan time, refreshed every minute for deadline warnings.
  const [nowPk, setNowPk] = useState(() => pkNow())
  const [importOpen, setImportOpen] = useState(false)
  const [skipFor, setSkipFor] = useState(null)
  const [cancelFor, setCancelFor] = useState(null)
  const [noReasonFor, setNoReasonFor] = useState(null)
  const [reasonFor, setReasonFor] = useState(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [deletePlanOpen, setDeletePlanOpen] = useState(false)
  const [crewConflict, setCrewConflict] = useState(null) // { names, onProceed }
  const [viewRide, setViewRide] = useState(null) // ride row to view
  const [viewLoading, setViewLoading] = useState(false)
  // Session cache: ride id → full ride object so repeated opens skip the fetch.
  const rideCache = useRef(new Map())
  const [deleting, setDeleting] = useState(false)

  // Inline Add Ride modal (Follow / No / plain Add Ride button)
  const [rideModal, setRideModal] = useState(null) // { initial, planRowId, pairedRowId, viaNo } | null

  // Filters
  const [blockFilter, setBlockFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [flightFilter, setFlightFilter] = useState('')
  const [vehicleFilter, setVehicleFilter] = useState('')

  // The page itself never scrolls - only the table does, in its own fixed-
  // height box, with its header frozen inside that box. topBarH re-triggers
  // the table-height recalc below whenever the fixed area above it changes
  // size (the Report panel opening, text wrapping on a narrow screen, etc.).
  const topBarRef = useRef(null)
  const [topBarH, setTopBarH] = useState(0)
  useEffect(() => {
    const el = topBarRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setTopBarH(entry.contentRect.height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Measure exactly how much viewport height is left below the table's own
  // start (title/summary/date-bar/Report above it, whatever chrome sits
  // above the page) rather than guessing - so the table's box is always
  // sized to make the WHOLE page fit in one viewport with no page scroll.
  const tableWrapRef = useRef(null)
  const [tableMaxH, setTableMaxH] = useState(null)
  // 48px = .app-content's own bottom padding (layout.css) - it sits AFTER
  // .page ends, so it has to come off the table's budget too, or the page
  // is left just tall enough to trigger a few px of page-level scroll.
  const APP_CONTENT_BOTTOM_PAD = 48
  useEffect(() => {
    const el = tableWrapRef.current
    if (!el) return
    const recalc = () => {
      const top = el.getBoundingClientRect().top
      setTableMaxH(Math.max(200, window.innerHeight - top - APP_CONTENT_BOTTOM_PAD))
    }
    recalc()
    window.addEventListener('resize', recalc)
    return () => window.removeEventListener('resize', recalc)
  }, [topBarH, reportOpen])

  const [flights, setFlights] = useState([])
  const [crew, setCrew] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [drivers, setDrivers] = useState([])

  useEffect(() => {
    if (!canView) return
    supabase
      .from('flights')
      .select('id, ref_no, flight_no, flight_code, route, block_type, flight_time, city_id, is_active')
      .then(({ data }) => setFlights((data ?? []).filter((f) => f.is_active)))
    supabase
      .from('crew')
      .select('id, ref_no, name, employee_no, stop_name, stop_lat, stop_lng, city_id, is_active')
      .then(({ data }) => setCrew((data ?? []).filter((c) => c.is_active)))
    supabase
      .from('vehicles')
      .select('id, ref_no, vehicle_no, city_id, is_active, driver_id, night_driver_id')
      .then(({ data }) => setVehicles((data ?? []).filter((v) => v.is_active)))
    supabase
      .from('drivers')
      .select('id, ref_no, name')
      .then(({ data }) => setDrivers(data ?? []))
  }, [canView])

  const fetchRows = useCallback(async () => {
    if (!canView) return
    setLoading(true)
    let q = supabase
      .from('ride_plan_rows')
      .select(
        '*, ride:rides(id, ref_no, return_of_ride_id, deadhead_mode, block_type, distance_km, status, count_km, vehicle_id, is_adhoc_vehicle, adhoc_vehicle_no, waypoints)',
      )
      .eq('plan_date', planDate)
      .order('seq')
    if (cityId != null) q = q.eq('city_id', cityId)
    const { data, error } = await q
    if (error) toast.error('Could not load the plan')
    const list = data ?? []

    // Rides dispatched on this same date that no plan row links to - e.g.
    // added straight on the Rides page, outside the Follow/No flow entirely.
    // A Follow-created ride always gets `ride_date = plan_date` (see the
    // planPrefill build in Rides.jsx), so matching on ride_date here finds
    // exactly this plan's would-be rides, no plan_date column needed on
    // `rides` itself.
    const linkedRideIds = new Set(list.filter((r) => r.ride_id).map((r) => r.ride_id))
    let rq = supabase
      .from('rides')
      .select(
        'id, ref_no, return_of_ride_id, deadhead_mode, distance_km, status, count_km, vehicle_id, flight_id, is_adhoc_vehicle, adhoc_vehicle_no, waypoints, block_type, flight_no, origin_label, dest_label, start_at, end_at, city_id',
      )
      .eq('ride_date', planDate)
    if (cityId != null) rq = rq.eq('city_id', cityId)
    const { data: dayRides } = await rq
    const extraRides = (dayRides ?? []).filter((r) => !linkedRideIds.has(r.id))

    // The linked ride's REAL crew (names, for their own column) and vehicle
    // (for the planned-vs-actual check below) - fetched client-side rather
    // than relying on a PostgREST count-aggregate embed that may not be
    // available. Covers both plan-row-linked rides and the extra ones above.
    const rideIds = [
      ...new Set([...list.filter((r) => r.ride?.id).map((r) => r.ride.id), ...extraRides.map((r) => r.id)]),
    ]
    let crewByRide = new Map()
    if (rideIds.length) {
      const { data: rc } = await supabase
        .from('ride_crew')
        .select('ride_id, seq, crew:crew(name)')
        .in('ride_id', rideIds)
        .order('seq')
      crewByRide = (rc ?? []).reduce((m, x) => {
        const arr = m.get(x.ride_id) || []
        if (x.crew?.name) arr.push(x.crew.name)
        return m.set(x.ride_id, arr)
      }, new Map())
    }

    // Build a ref_no lookup for ALL day rides so parent IDs are always
    // resolvable even when a ride is linked to a plan row (excluded from
    // extraRides) but its embedded r.ride comes back null for any reason.
    const refNoById = new Map()
    ;(dayRides ?? []).forEach((r) => refNoById.set(r.id, r.ref_no))
    list.forEach((r) => r.ride?.id && refNoById.set(r.ride.id, r.ride.ref_no))

    const rideDisplayRef = (ride) => {
      if (!ride) return null
      const parentId = ride.return_of_ride_id
      if (!parentId) return String(ride.ref_no)
      const parentRef = refNoById.get(parentId) ?? ride.ref_no
      if (ride.block_type === 'return_leg') return `${parentRef}-R`
      if (ride.block_type === 'deadhead')
        return ride.deadhead_mode === 'airport' ? `${parentRef}-PD` : `${parentRef}-D`
      if (ride.block_type === 'pickup') return `${parentRef}-P`
      return String(ride.ref_no)
    }

    const planRows = list.map((r) => {
      const names = r.ride?.id ? crewByRide.get(r.ride.id) || [] : null
      const actualVehicleNo = r.ride?.is_adhoc_vehicle
        ? (r.ride.adhoc_vehicle_no || '—').replace(/^Ad-Hoc 0*(\d+)$/, 'Ad-Hoc $1')
        : r.ride?.vehicle_id
          ? vehicles.find((v) => v.id === r.ride.vehicle_id)?.vehicle_no ?? null
          : null
      return {
        ...r,
        displayRef: rideDisplayRef(r.ride),
        actualCrewNames: names,
        actualCrewCount: names ? displayCrewCount(names, r.block_type) : null,
        actualVehicleNo,
      }
    })

    // Synthetic rows, client-side only (never written to ride_plan_rows) -
    // `planned_km: null` and `crew_matches: []` are the whole trick: every KM/
    // crew total downstream (top summary, Report panel) sums real plan rows'
    // `planned_km` plus these rows' 0, while `actualKm` still sums their
    // linked ride's billable KM same as any followed row - so an extra ride's
    // distance only ever lands in Actual, never Planned.
    const extraRows = extraRides
      .sort((a, b) => (a.start_at ?? '').localeCompare(b.start_at ?? ''))
      .map((r) => {
      const names = crewByRide.get(r.id) || []
      const actualVehicleNo = r.is_adhoc_vehicle
        ? (r.adhoc_vehicle_no || '—').replace(/^Ad-Hoc 0*(\d+)$/, 'Ad-Hoc $1')
        : r.vehicle_id
          ? vehicles.find((v) => v.id === r.vehicle_id)?.vehicle_no ?? null
          : null
      return {
        id: `extra-${r.id}`,
        isExtra: true,
        seq: Number.MAX_SAFE_INTEGER,
        trip_id: null,
        block_type: r.block_type,
        flight_no: r.flight_no,
        origin: r.origin_label,
        destination: r.dest_label,
        start_time: isoHHMM(r.start_at),
        end_time: isoHHMM(r.end_at),
        planned_km: null,
        crew_matches: [],
        crew_count: null,
        car: null,
        is_adhoc_car: false,
        matched_vehicle_id: null,
        status: 'followed',
        skip_reason: null,
        via_no: false,
        ride: r,
        displayRef: rideDisplayRef(r),
        actualCrewNames: names,
        actualCrewCount: displayCrewCount(names, r.block_type),
        actualVehicleNo,
      }
    })

    // Place each extra ride immediately after the LAST plan row that shares its
    // flight_id, so "remaining crew dispatched separately" groups with the
    // parent pickup/dropoff instead of floating at the bottom.
    const extraByFlight = new Map()
    const extraNoFlight = []
    for (const e of extraRows) {
      const fid = e.ride?.flight_id
      if (fid) { if (!extraByFlight.has(fid)) extraByFlight.set(fid, []); extraByFlight.get(fid).push(e) }
      else extraNoFlight.push(e)
    }
    const result = [...planRows]
    const inserted = new Set()
    for (const [fid, extras] of extraByFlight) {
      let lastIdx = -1
      for (let i = 0; i < result.length; i++) {
        if (!result[i].isExtra && result[i].matched_flight_id === fid) lastIdx = i
      }
      if (lastIdx >= 0) {
        let pos = lastIdx + 1
        while (pos < result.length && result[pos].isExtra) pos++
        result.splice(pos, 0, ...extras.map((e) => ({ ...e, isChild: true })))
        extras.forEach((e) => inserted.add(e.id))
      }
    }
    for (const e of extraRows) {
      if (!inserted.has(e.id)) result.push(e)
    }
    setRows(result)
    setLoading(false)
  }, [canView, planDate, cityId, vehicles])

  useEffect(() => {
    fetchRows()
  }, [fetchRows])

  // Deadhead / Return Leg rows aren't dispatched directly - they ride along on
  // the ALREADY-BUILT "Also create a Deadhead" (Pickup) / "Also create a
  // Return Leg" (Dropoff) features. Once this row's own sibling is followed,
  // check whether its companion ride now exists and auto-link it. Paired by
  // adjacent `seq`, NOT Trip ID - a Deadhead is the row immediately BEFORE
  // its Pickup, a Return Leg immediately AFTER its Dropoff (confirmed
  // against real data; Trip ID only happens to match for the Deadhead case).
  const siblingBlock = { deadhead: 'pickup', return_leg: 'dropoff' }
  const siblingSeq = (r) => (r.block_type === 'deadhead' ? r.seq + 1 : r.block_type === 'return_leg' ? r.seq - 1 : null)
  const reconciling = useRef(false)
  useEffect(() => {
    if (!canEdit) return
    const pending = rows.filter((r) => r.status === 'pending' && siblingBlock[r.block_type])
    if (!pending.length || reconciling.current) return
    reconciling.current = true
    ;(async () => {
      let changed = false
      for (const r of pending) {
        const sibling = rows.find(
          (s) => s.seq === siblingSeq(r) && s.block_type === siblingBlock[r.block_type] && s.status === 'followed',
        )
        if (!sibling?.ride_id) continue
        const { data: companion } = await supabase
          .from('rides')
          .select('id')
          .eq('return_of_ride_id', sibling.ride_id)
          .eq('block_type', r.block_type)
          .maybeSingle()
        if (companion) {
          await supabase
            .from('ride_plan_rows')
            .update({ status: 'followed', ride_id: companion.id, via_no: sibling.via_no ?? false })
            .eq('id', r.id)
          changed = true
        }
      }
      reconciling.current = false
      if (changed) fetchRows()
    })()
  }, [rows, fetchRows, canEdit])

  const canFollow = (r) => r.status === 'pending'

  // Open the full ride view modal.  Cache hit = instant; miss = one fetch.
  const openRideView = useCallback(async (rideId) => {
    if (!rideId) return
    if (rideCache.current.has(rideId)) {
      setViewRide(rideCache.current.get(rideId))
      return
    }
    setViewLoading(true)
    const { data, error } = await supabase.from('rides').select(RIDE_SELECT).eq('id', rideId).single()
    setViewLoading(false)
    if (error || !data) return toast.error('Could not load ride details')
    rideCache.current.set(rideId, data)
    setViewRide(data)
  }, [])

  // Refresh Pakistan clock every minute so deadline badges stay current.
  useEffect(() => {
    const id = setInterval(() => setNowPk(pkNow()), 60_000)
    return () => clearInterval(id)
  }, [])

  // Returns minutes until start_time on planDate; null when not applicable.
  const minutesUntil = useCallback((r) => {
    if (!r.start_time || r.status !== 'pending') return null
    const [hh, mm] = r.start_time.split(':').map(Number)
    const target = new Date(Date.UTC(
      ...planDate.split('-').map(Number).map((v, i) => i === 1 ? v - 1 : v),
      hh - 5, mm  // planDate is PK date; convert HH:MM PK to UTC
    ))
    return Math.round((target - nowPk) / 60_000)
  }, [planDate, nowPk])

  // Fetch a plan row, build the RideModal prefill, open the modal inline.
  const openPlanRideModal = async (planRowId, viaNo = false, skipReason = null) => {
    const { data: planRow, error } = await supabase
      .from('ride_plan_rows')
      .select('*')
      .eq('id', planRowId)
      .single()
    if (error || !planRow) return toast.error('Could not load the plan row')

    let pairedRowId = null
    const pairedBlock = planRow.block_type === 'pickup' ? 'deadhead' : planRow.block_type === 'dropoff' ? 'return_leg' : null
    if (pairedBlock) {
      const targetSeq = planRow.block_type === 'pickup' ? planRow.seq - 1 : planRow.seq + 1
      let pairQ = supabase
        .from('ride_plan_rows')
        .select('id')
        .eq('city_id', planRow.city_id)
        .eq('seq', targetSeq)
        .eq('block_type', pairedBlock)
        .eq('status', 'pending')
      if (planRow.car) pairQ = pairQ.eq('car', planRow.car)
      const { data: pair } = await pairQ.maybeSingle()
      pairedRowId = pair?.id ?? null
    }

    const initial = buildPlanInitial(planRow, { flights, crew, viaNo })
    if (pairedRowId) {
      if (planRow.block_type === 'pickup') initial.alsoDeadhead = true
      else if (planRow.block_type === 'dropoff') initial.alsoReturnLeg = true
    }

    // Crew availability check: warn if any planned crew are already on another
    // ride (any flight) that overlaps this plan row's time window.
    const crewIds = (planRow.crew_matches || []).map((m) => m.crew_id).filter(Boolean)
    if (crewIds.length && planRow.start_time && planRow.plan_date) {
      const dayStart = `${planRow.plan_date}T00:00:00+05:00`
      const dayEnd   = `${planRow.plan_date}T23:59:59+05:00`
      const { data: busyLinks } = await supabase
        .from('ride_crew')
        .select('crew_id, ride:rides!inner(id, ref_no, start_at, end_at, status, flight_no, block_type)')
        .in('crew_id', crewIds)
        .neq('ride.status', 'cancelled')
        .gte('ride.start_at', dayStart)
        .lte('ride.start_at', dayEnd)

      if (busyLinks?.length) {
        // Build a PK ISO timestamp for this plan row's window.
        const planStart = new Date(`${planRow.plan_date}T${planRow.start_time}:00+05:00`)
        const planEnd   = planRow.end_time
          ? new Date(`${planRow.plan_date}T${planRow.end_time}:00+05:00`)
          : new Date(planStart.getTime() + 90 * 60_000)

        const conflicts = busyLinks.filter((lk) => {
          const rStart = new Date(lk.ride.start_at)
          const rEnd   = new Date(lk.ride.end_at)
          return rStart < planEnd && rEnd > planStart
        })

        if (conflicts.length) {
          const conflictNames = conflicts.map((lk) => {
            const c = crew.find((x) => x.id === lk.crew_id)
            return `${c?.name ?? 'Crew'} — Ride ${lk.ride.ref_no} (${lk.ride.flight_no || lk.ride.block_type})`
          })
          // Store conflict info; the modal's "Proceed" callback will open rideModal.
          setCrewConflict({
            names: conflictNames,
            onProceed: () => setRideModal({ initial, planRowId: planRow.id, pairedRowId, viaNo, skipReason }),
          })
          return
        }
      }
    }

    setRideModal({ initial, planRowId: planRow.id, pairedRowId, viaNo, skipReason })
  }

  // Crew-mismatch quick-dispatch: opens Add Ride pre-filled with a SINGLE
  // crew member from a followed plan row where that crew member was not
  // included in the dispatched ride.  No plan row is linked on completion
  // (planRowId: null) - the created ride shows up as an extra row.
  const openCrewDispatchModal = useCallback(async (planRowId, crewId) => {
    const { data: planRow, error } = await supabase
      .from('ride_plan_rows')
      .select('*')
      .eq('id', planRowId)
      .single()
    if (error || !planRow) return toast.error('Could not load plan row')
    const crewObj = crew.find((c) => c.id === crewId)
    const initial = buildPlanInitial(planRow, { flights, crew, viaNo: false })
    if (crewObj) initial.crewList = [crewObj]
    if (planRow.block_type === 'pickup') initial.alsoDeadhead = true
    if (planRow.block_type === 'dropoff') initial.alsoReturnLeg = true
    setRideModal({ initial, planRowId: null, pairedRowId: null, viaNo: false, skipReason: null })
  }, [crew, flights])

  // "No" collects a reason, then opens the inline Add Ride modal.
  // The reason is NOT written to the DB yet — it is saved together with the
  // `followed` update in onRideModalDone, so closing the modal without
  // submitting has zero side-effects on the plan row.
  const doNoReason = (reason) => {
    if (!noReasonFor) return
    const trimmed = reason.trim()
    const id = noReasonFor.id
    setNoReasonFor(null)
    openPlanRideModal(id, true, trimmed || null)
  }

  const onRideModalDone = async (result) => {
    const m = rideModal
    setRideModal(null)
    if (!m?.planRowId) { fetchRows(); return }
    const rideId = result?.rideId ?? null
    const pairedRideId = result?.deadheadRideId ?? result?.returnLegRideId ?? null
    const upd = await supabase
      .from('ride_plan_rows')
      .update({ status: 'followed', ride_id: rideId, via_no: m.viaNo ?? false, skip_reason: m.skipReason ?? null })
      .eq('id', m.planRowId)
      .select('id')
    if (upd.error || !upd.data?.length) {
      toast.error(upd.error?.message || 'Ride created, but the plan row could not be updated')
    }
    if (m.pairedRowId && pairedRideId) {
      await supabase
        .from('ride_plan_rows')
        .update({ status: 'followed', ride_id: pairedRideId, via_no: m.viaNo ?? false })
        .eq('id', m.pairedRowId)
    }
    fetchRows()
  }

  // A "Skip" can instead LINK an already-created ride (e.g. one dispatched
  // manually on the Rides page, outside the Follow flow) by its ref number -
  // the row then counts as followed and its Actual KM feeds the report,
  // same as a row that went through Follow.
  const doSkip = async (reason, refNo) => {
    if (!skipFor) return
    if (refNo) {
      const { data: linkedRide, error: findErr } = await supabase
        .from('rides')
        .select('id')
        .eq('ref_no', Number(refNo))
        .maybeSingle()
      if (findErr) return toast.error(findErr.message)
      if (!linkedRide) return toast.error(`Ride ${refNo} not found`)
      const { error } = await supabase
        .from('ride_plan_rows')
        .update({
          status: 'followed',
          ride_id: linkedRide.id,
          skip_reason: reason.trim() || null,
          via_no: true,
        })
        .eq('id', skipFor.id)
      if (error) return toast.error(error.message)
      toast.success(`Linked to ride ${refNo}`)
      setSkipFor(null)
      return fetchRows()
    }
    const { error } = await supabase
      .from('ride_plan_rows')
      .update({ status: 'skipped', skip_reason: reason.trim() || null })
      .eq('id', skipFor.id)
    if (error) return toast.error(error.message)
    setSkipFor(null)
    fetchRows()
  }

  const doCancelPlanRide = async (reason) => {
    if (!cancelFor?.ride?.id) return
    const cancelPayload = {
      status: 'cancelled',
      cancel_reason: reason,
      cancelled_at: new Date().toISOString(),
      cancelled_by: profile?.id ?? null,
      count_km: false,
    }
    // Cancel the main ride
    const { error: rideErr } = await supabase
      .from('rides')
      .update(cancelPayload)
      .eq('id', cancelFor.ride.id)
    if (rideErr) return toast.error(rideErr.message)

    // Also cancel any companion rides (deadhead / return leg) linked to this ride
    const { data: companions, error: compErr } = await supabase
      .from('rides')
      .select('id')
      .eq('return_of_ride_id', cancelFor.ride.id)
      .neq('status', 'cancelled')
    if (compErr) toast.error('Companion query error: ' + compErr.message)
    if (!companions?.length) {
      toast('Koi companion nahi mila is ride ka (ride id: ' + cancelFor.ride.id + ')')
    }
    if (companions?.length) {
      const companionIds = companions.map((c) => c.id)
      await supabase.from('rides').update(cancelPayload).in('id', companionIds)
      // Reopen any plan rows that were linked to those companion rides
      await supabase
        .from('ride_plan_rows')
        .update({ status: 'pending', ride_id: null, skip_reason: null, via_no: false })
        .in('ride_id', companionIds)
    }

    // Reopen the main plan row
    await supabase
      .from('ride_plan_rows')
      .update({ status: 'pending', ride_id: null, skip_reason: null, via_no: false })
      .eq('id', cancelFor.id)
    setCancelFor(null)
    fetchRows()
  }

  const reopen = async (row) => {
    const { error } = await supabase
      .from('ride_plan_rows')
      .update({ status: 'pending', skip_reason: null, ride_id: null, via_no: false })
      .eq('id', row.id)
    if (error) return toast.error(error.message)
    fetchRows()
  }

  // Deletes this day's plan rows only (not the rides they were followed
  // into) - a plan can be re-uploaded after a correction without touching
  // whatever has already been dispatched. `.select('id')` + checking the
  // returned count (rather than trusting a null `error`) matters here - an
  // RLS policy that silently excludes some rows (e.g. a city the caller
  // can't touch) still reports no error, so a delete that quietly did
  // nothing (or did less than expected) used to look identical to success.
  const doDeletePlan = async () => {
    setDeleting(true)
    // `rows` also holds synthetic "Extra ride" entries (see fetchRows below)
    // that were never real ride_plan_rows to begin with - exclude them or
    // this comparison would always look like a partial delete.
    const expected = rows.filter((r) => !r.isExtra).length
    let q = supabase.from('ride_plan_rows').delete().eq('plan_date', planDate)
    if (cityId != null) q = q.eq('city_id', cityId)
    const { data, error } = await q.select('id')
    setDeleting(false)
    if (error) return toast.error(error.message)
    const deleted = data?.length ?? 0
    if (deleted === 0) return toast.error('Nothing was deleted - check your permissions for this city')
    if (deleted < expected) {
      toast.error(`Only ${deleted} of ${expected} row(s) deleted - the rest may belong to a city you can't edit`)
    } else {
      toast.success(`Deleted the plan for ${fmtDate(planDate)}`)
    }
    setDeletePlanOpen(false)
    fetchRows()
  }

  const report = useMemo(() => {
    const byBlock = {}
    for (const r of rows) {
      const b = (byBlock[r.block_type] ??= {
        block: r.block_type,
        followed: 0,
        plannedKm: 0,
        actualKm: 0,
        crewMismatch: 0,
      })
      if (r.status !== 'followed') continue
      b.followed += 1
      b.plannedKm += Number(r.planned_km) || 0
      b.actualKm += Number(billableKm(r.ride)) || 0
      if (hasCrewMismatch(r)) b.crewMismatch += 1
    }
    return Object.values(byBlock)
  }, [rows])

  // Top summary: the WHOLE day's planned KM per block type (every row, not
  // just followed ones - this is the plan itself), alongside how much of it
  // has actually happened so far (followed rows only).
  const summary = useMemo(() => {
    const byBlock = Object.fromEntries(SUMMARY_BLOCKS.map((b) => [b, { plannedKm: 0, actualKm: 0, followed: 0 }]))
    for (const r of rows) {
      const b = byBlock[r.block_type]
      if (!b) continue
      b.plannedKm += Number(r.planned_km) || 0
      if (r.status === 'followed') {
        b.followed += 1
        b.actualKm += Number(billableKm(r.ride)) || 0
      }
    }
    byBlock.total = Object.values(byBlock).reduce(
      (t, b) => ({ plannedKm: t.plannedKm + b.plannedKm, actualKm: t.actualKm + b.actualKm, followed: t.followed + b.followed }),
      { plannedKm: 0, actualKm: 0, followed: 0 },
    )
    return byBlock
  }, [rows])

  const statusCounts = useMemo(
    () => ({
      followed: rows.filter((r) => r.status === 'followed').length,
      no: rows.filter((r) => r.status === 'skipped').length,
      pending: rows.filter((r) => r.status === 'pending').length,
    }),
    [rows],
  )
  const totalDelta = summary.total.actualKm - summary.total.plannedKm

  const flightFilterOpts = useMemo(
    () => [
      { value: '', label: 'All flights' },
      ...flights
        .filter((f) => cityId == null || f.city_id === cityId)
        .map((f) => ({ value: f.id, label: f.flight_no, sub: f.flight_code })),
    ],
    [flights, cityId],
  )

  const vehicleFilterOpts = useMemo(
    () => [
      { value: '', label: 'All vehicles' },
      ...vehicles
        .filter((v) => cityId == null || v.city_id === cityId)
        .map((v) => ({ value: v.id, label: v.vehicle_no })),
    ],
    [vehicles, cityId],
  )

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (blockFilter !== 'all' && r.block_type !== blockFilter) return false
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (flightFilter) {
        const fid = r.isExtra ? r.ride?.flight_id : r.matched_flight_id
        if (fid !== flightFilter) return false
      }
      if (vehicleFilter) {
        const vid = r.isExtra ? r.ride?.vehicle_id : r.matched_vehicle_id
        if (vid !== vehicleFilter) return false
      }
      return true
    })
  }, [rows, blockFilter, statusFilter, flightFilter, vehicleFilter])

  const hasActiveFilter = blockFilter !== 'all' || statusFilter !== 'all' || flightFilter || vehicleFilter

  const columns = [
    { key: 'trip', header: 'Trip', render: (r) => {
      const mins = minutesUntil(r)
      const badge =
        mins !== null && mins <= 0   ? <span className="rp-deadline-badge rp-deadline-overdue">Overdue</span> :
        mins !== null && mins <= 30  ? <span className="rp-deadline-badge rp-deadline-now">In {mins}m</span> :
        mins !== null && mins <= 90  ? <span className="rp-deadline-badge rp-deadline-soon">In {mins}m</span> :
        null
      if (!r.isExtra) return <>{r.trip_id}{badge}</>
      const ref = r.displayRef ?? r.ride?.ref_no ?? '—'
      return r.isChild ? <span className="rp-child-ref">↳ {ref}</span> : ref
    } },
    { key: 'block', header: 'Block', render: (r) => blockLabel(r.block_type) },
    { key: 'flight', header: 'Flight', render: (r) => r.flight_no || '—' },
    {
      key: 'route',
      header: 'Route',
      render: (r) => (r.origin && r.destination ? `${r.origin} → ${r.destination}` : '—'),
    },
    {
      key: 'time',
      header: 'Time',
      render: (r) =>
        r.end_time
          ? `${fmtTime12(r.start_time) || '—'} - ${fmtTime12(r.end_time)}`
          : fmtTime12(r.start_time) || '—',
    },
    { key: 'crew', header: 'Crew', render: (r) => {
      // Names from extra child rides for this plan row (same flight + block),
      // used to hide the dispatch icon once that crew member's ride exists.
      const extraCrewSet = (!r.isExtra && r.matched_flight_id)
        ? new Set(
            filteredRows
              .filter((e) => e.isExtra && e.isChild && e.ride?.flight_id === r.matched_flight_id && e.block_type === r.block_type)
              .flatMap((e) => e.actualCrewNames ?? [])
          )
        : null
      return (
        <CrewMatchCell
          row={r}
          crew={crew}
          onDispatchCrew={canEdit && canAddRide ? openCrewDispatchModal : null}
          extraCrewSet={extraCrewSet}
        />
      )
    } },
    {
      key: 'crewCount',
      header: 'Crew C',
      align: 'right',
      render: (r) => {
        if (r.isExtra) return '—'
        if (r.block_type === 'deadhead' || r.block_type === 'return_leg') return 0
        return r.crew_count ?? r.crew_matches?.length ?? '—'
      },
    },
    {
      key: 'actualCrew',
      header: 'Actual Crew',
      render: (r) =>
        r.status === 'followed' && r.actualCrewNames ? (
          r.actualCrewNames.length ? (
            <div className="crew-cell-stack">
              {r.actualCrewNames.map((n, i) => (
                <div key={i}>{n}</div>
              ))}
            </div>
          ) : (
            <span className="secondary">—</span>
          )
        ) : (
          '—'
        ),
    },
    {
      key: 'actualCrewCount',
      header: 'A Crew C',
      align: 'right',
      render: (r) => (r.status === 'followed' ? r.actualCrewCount ?? '—' : '—'),
    },
    {
      key: 'car',
      header: 'Vehicle',
      render: (r) => {
        if (r.isExtra) return <span className="rp-cell-wrap">{r.actualVehicleNo || '—'}</span>
        return (
          <div className="rp-cell-wrap">
            <div>
              {r.car || '—'}
              {r.is_adhoc_car && <span className="status-text off"> · ad-hoc</span>}
              {!r.is_adhoc_car && r.car && !r.matched_vehicle_id && <span className="status-text bad"> · not in fleet</span>}
            </div>
            {r.status === 'followed' && r.actualVehicleNo && r.actualVehicleNo !== r.car && (
              <div className="status-text bad">Actual: {r.actualVehicleNo}</div>
            )}
          </div>
        )
      },
    },
    { key: 'status', header: 'Status', render: (r) => <StatusCell row={r} /> },
    { key: 'km', header: 'Planned KM', align: 'right', render: (r) => (r.planned_km != null ? Number(r.planned_km).toFixed(2) : '—') },
    {
      key: 'actual',
      header: 'Actual KM',
      align: 'right',
      render: (r) => (r.status === 'followed' && r.ride ? (Number(billableKm(r.ride)) || 0).toFixed(2) : '—'),
    },
    {
      key: 'delta',
      header: 'Difference',
      align: 'right',
      render: (r) => {
        if (r.isExtra) return <span className="secondary">—</span>
        if (r.status !== 'followed' || !r.ride) return '—'
        const d = (Number(billableKm(r.ride)) || 0) - (Number(r.planned_km) || 0)
        return <span className={`status-text ${d > 0 ? 'bad' : 'on'}`}>{d.toFixed(2)}</span>
      },
    },
    {
      key: 'actions',
      header: 'Action',
      render: (r) => {
        const gm = r.status === 'followed' ? gmapsRoute(r.ride?.waypoints) : null
        return (
          <div className="rp-row-actions">
            {canEdit && canAddRide && canFollow(r) && (
              <button
                type="button"
                className="btn btn-ghost btn-square btn-sm rp-follow-btn"
                onClick={() => openPlanRideModal(r.id, false)}
              >
                Follow
              </button>
            )}
            {canEdit && canFollow(r) && (
              <button
                type="button"
                className="btn btn-ghost btn-square btn-sm rp-no-btn"
                onClick={() => setNoReasonFor(r)}
              >
                No
              </button>
            )}
            {canEdit && r.status === 'pending' && (
              <button
                type="button"
                className="icon-btn rp-cancel-btn"
                title="Cancel"
                onClick={() => setSkipFor(r)}
              >
                <XCircle size={15} />
              </button>
            )}
            {canEdit && !r.isExtra && r.status === 'followed' && r.ride?.id && r.ride?.status !== 'cancelled' && (
              <button
                type="button"
                className="icon-btn rp-cancel-btn"
                title="Cancel this ride"
                onClick={() => setCancelFor(r)}
              >
                <Ban size={15} />
              </button>
            )}
            {canEdit && r.status === 'skipped' && (
              <button type="button" className="btn btn-ghost btn-square btn-sm" onClick={() => reopen(r)}>
                Reopen
              </button>
            )}
            {r.skip_reason && (
              <button
                type="button"
                className="icon-btn rp-reason-btn"
                title="View reason"
                onClick={() => setReasonFor(r)}
              >
                <MessageSquare size={15} />
              </button>
            )}
            {r.ride?.id && (
              <button
                type="button"
                className="icon-btn"
                title="View ride"
                onClick={() => openRideView(r.ride.id)}
              >
                <Eye size={15} />
              </button>
            )}
            {gm && (
              <a href={gm} target="_blank" rel="noreferrer" className="icon-btn" title="Open ride route in Google Maps">
                <Navigation size={15} />
              </a>
            )}
          </div>
        )
      },
    },
  ]

  if (!canView) {
    return (
      <div className="page">
        <h1 className="page-title">Ride Plan</h1>
        <p className="page-subtitle">You don&rsquo;t have access to this page.</p>
      </div>
    )
  }

  return (
    <div className="page">
      <div ref={topBarRef} className="rp-frozen-top">
        <div className="page-header">
          <div>
            <h1 className="page-title">Ride Plan</h1>
            <p className="page-subtitle">
              {rows.length} rows · {cityName}
            </p>
          </div>
          <div className="page-actions">
            <button className="icon-btn" onClick={fetchRows} title="Refresh">
              <RefreshCw size={15} />
            </button>
            <button
              className={`filter-toggle${reportOpen ? ' on' : ''}`}
              onClick={() => setReportOpen((v) => !v)}
            >
              <Sigma size={13} /> Report
            </button>
            {canAddRide && (
              <button className="btn btn-ghost btn-square btn-sm" onClick={() => setRideModal({ initial: null, planRowId: null, pairedRowId: null, viaNo: false })}>
                <Plus size={14} /> Add Ride
              </button>
            )}
            {canAdd && (
              <button className="btn btn-ghost btn-square btn-sm" onClick={() => setImportOpen(true)}>
                <Upload size={14} /> Upload plan
              </button>
            )}
            {canDelete && rows.length > 0 && (
              <button className="btn btn-square btn-sm btn-danger" onClick={() => setDeletePlanOpen(true)}>
                <Trash2 size={14} /> Delete plan
              </button>
            )}
          </div>
        </div>

        <StatCards
          items={[
            {
              key: 'total',
              label: 'Total',
              value: `${summary.total.plannedKm.toFixed(2)} km`,
              hint: `Actual: ${summary.total.actualKm.toFixed(2)} km${summary.total.followed ? ` (${summary.total.followed} followed)` : ''}`,
              active: true,
            },
            {
              key: 'difference',
              label: 'Difference',
              value: (
                <span style={{ color: totalDelta > 0 ? 'var(--danger)' : 'var(--success)' }}>
                  {totalDelta >= 0 ? '+' : ''}
                  {totalDelta.toFixed(2)} km
                </span>
              ),
              hint: totalDelta > 0 ? 'over plan' : totalDelta < 0 ? 'under plan' : 'on plan',
            },
            ...SUMMARY_BLOCKS.map((b) => ({
              key: b,
              label: blockLabel(b),
              value: `${summary[b].plannedKm.toFixed(2)} km`,
              hint: `Actual: ${summary[b].actualKm.toFixed(2)} km${summary[b].followed ? ` (${summary[b].followed} followed)` : ''}`,
            })),
            {
              key: 'followed-count',
              label: 'Followed',
              value: statusCounts.followed,
              hint: `${statusCounts.pending} pending`,
            },
            {
              key: 'no-count',
              label: 'No',
              value: statusCounts.no,
              hint: `${statusCounts.pending} pending`,
            },
          ]}
        />

        <div className="rp-datebar">
          <button type="button" className="icon-btn" onClick={() => setPlanDate((d) => addDays(d, -1))}>
            <ChevronLeft size={16} />
          </button>
          <input
            type="date"
            className="input"
            value={planDate}
            onChange={(e) => setPlanDate(e.target.value)}
          />
          <button type="button" className="icon-btn" onClick={() => setPlanDate((d) => addDays(d, 1))}>
            <ChevronRight size={16} />
          </button>
          {planDate !== pkToday() && (
            <button type="button" className="btn btn-ghost btn-square btn-sm" onClick={() => setPlanDate(pkToday())}>
              Today
            </button>
          )}
          <div className="rp-datebar-sep" />
          <select
            className="filter-select"
            value={blockFilter}
            onChange={(e) => setBlockFilter(e.target.value)}
          >
            <option value="all">All blocks</option>
            <option value="deadhead">Deadhead</option>
            <option value="pickup">Pickup</option>
            <option value="dropoff">Drop Off</option>
            <option value="return_leg">Return Leg</option>
          </select>
          <select
            className="filter-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="followed">Followed</option>
            <option value="skipped">Cancelled</option>
          </select>
          <div className="filter-searchselect">
            <SearchSelect
              value={flightFilter}
              onChange={setFlightFilter}
              options={flightFilterOpts}
              placeholder="All flights"
            />
          </div>
          <div className="filter-searchselect">
            <SearchSelect
              value={vehicleFilter}
              onChange={setVehicleFilter}
              options={vehicleFilterOpts}
              placeholder="All vehicles"
            />
          </div>
          {hasActiveFilter && (
            <button
              type="button"
              className="btn btn-ghost btn-square btn-sm"
              onClick={() => { setBlockFilter('all'); setStatusFilter('all'); setFlightFilter(''); setVehicleFilter('') }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {reportOpen && (
        <div className="rp-report">
          <h3>Plan vs Actual · {fmtDate(planDate)}</h3>
          {report.length === 0 ? (
            <p className="secondary">No followed rows yet for this date.</p>
          ) : (
            <table className="data-table dense">
              <thead>
                <tr>
                  <th>Block</th>
                  <th>Followed</th>
                  <th>Planned KM</th>
                  <th>Actual KM</th>
                  <th>Δ</th>
                  <th>Crew mismatch</th>
                </tr>
              </thead>
              <tbody>
                {report.map((b) => (
                  <tr key={b.block}>
                    <td>{blockLabel(b.block)}</td>
                    <td>{b.followed}</td>
                    <td>{b.plannedKm.toFixed(2)}</td>
                    <td>{b.actualKm.toFixed(2)}</td>
                    <td className={b.actualKm - b.plannedKm > 0 ? 'status-text bad' : 'status-text on'}>
                      {(b.actualKm - b.plannedKm).toFixed(2)}
                    </td>
                    <td className={b.crewMismatch > 0 ? 'status-text bad' : 'status-text off'}>{b.crewMismatch}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div
        ref={tableWrapRef}
        className="rp-plan-table"
        style={tableMaxH ? { '--rp-table-max-h': `${tableMaxH}px` } : undefined}
      >
        <DataTable
          columns={columns}
          rows={filteredRows}
          rowKey={(r) => r.id}
          loading={loading}
          emptyLabel="No plan uploaded for this date"
          rowClassName={(r) => {
            if (r.status === 'followed') return 'rp-row-followed'
            if (r.status === 'skipped') return 'rp-row-cancelled'
            const mins = minutesUntil(r)
            if (mins !== null && mins <= 90 && mins > 0) return 'rp-row-urgent'
            if (mins !== null && mins <= 0) return 'rp-row-overdue'
            return ''
          }}
        />
      </div>

      {importOpen && (
        <ImportModal
          allowedCities={allowedCities}
          flights={flights}
          crew={crew}
          vehicles={vehicles}
          cityId={cityId}
          createdBy={profile?.id}
          onClose={() => setImportOpen(false)}
          onDone={(earliestDate) => {
            setImportOpen(false)
            if (earliestDate && earliestDate !== planDate) setPlanDate(earliestDate)
            else fetchRows()
          }}
        />
      )}

      {crewConflict && (
        <Modal title="Crew conflict" onClose={() => setCrewConflict(null)} size="sm">
          <p style={{ marginBottom: 10 }}>Ye crew members is waqt already kisi aur ride pe hain:</p>
          <ul style={{ margin: '0 0 16px 18px', lineHeight: 1.7 }}>
            {crewConflict.names.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
          <p style={{ marginBottom: 16, color: 'var(--muted)', fontSize: 13 }}>
            Phir bhi Follow karna chahte hain?
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setCrewConflict(null)}>Cancel</button>
            <button
              className="btn btn-sm"
              style={{ background: 'var(--danger)', color: '#fff', borderColor: 'var(--danger)' }}
              onClick={() => { crewConflict.onProceed(); setCrewConflict(null) }}
            >
              Follow anyway
            </button>
          </div>
        </Modal>
      )}
      {viewLoading && (
        <Modal title="Loading ride…" onClose={() => setViewLoading(false)} size="sm">
          <p style={{ padding: '12px 0', color: 'var(--muted)' }}>Ride data load ho rahi hai…</p>
        </Modal>
      )}
      {viewRide && (
        <RideModal
          row={viewRide}
          startInEdit={false}
          canEdit={canEdit}
          flights={flights}
          crew={crew}
          vehicles={vehicles}
          drivers={drivers}
          allowedCities={allowedCities}
          createdBy={profile?.id}
          onClose={() => setViewRide(null)}
          onDone={() => {
            rideCache.current.delete(viewRide.id) // invalidate so edit changes reflect
            setViewRide(null)
            fetchRows()
          }}
        />
      )}
      {skipFor && <SkipModal row={skipFor} onClose={() => setSkipFor(null)} onSkip={doSkip} />}
      {cancelFor && <CancelPlanRideModal row={cancelFor} onClose={() => setCancelFor(null)} onConfirm={doCancelPlanRide} />}
      {noReasonFor && (
        <NoReasonModal row={noReasonFor} onClose={() => setNoReasonFor(null)} onContinue={doNoReason} />
      )}
      {reasonFor && <ReasonPopup row={reasonFor} onClose={() => setReasonFor(null)} />}

      {rideModal && (
        <RideModal
          flights={flights}
          crew={crew}
          vehicles={vehicles}
          drivers={drivers}
          allowedCities={allowedCities}
          defaultCityId={cityId}
          createdBy={profile?.id}
          initial={rideModal.initial}
          onClose={() => setRideModal(null)}
          onDone={onRideModalDone}
        />
      )}

      <ConfirmDelete
        open={deletePlanOpen}
        title={`Delete the plan for ${fmtDate(planDate)}`}
        message={`This permanently deletes ${rows.length} plan row(s) for ${fmtDate(planDate)}${cityName !== 'All cities' ? ` · ${cityName}` : ''}. Rides already dispatched from them are NOT affected.`}
        busy={deleting}
        onConfirm={doDeletePlan}
        onClose={() => setDeletePlanOpen(false)}
      />
    </div>
  )
}

const NO_REASON_OPTIONS = [
  'CP/FO Not Sharing Car',
  'Crew Change',
  'Foreigner FO',
  'Route Change',
  '2 Pickup / 3',
  'Ride Time Mismatched',
  'Flight Change',
  'Combine with other',
  'Double Sector',
  'Single Pickup / Combine',
  'Flight Delay',
  'Off Load',
  'Completed with Off load',
  'Extra Pickup',
]

function NoReasonModal({ row, onClose, onContinue }) {
  const [selected, setSelected] = useState([])
  const [busy, setBusy] = useState(false)

  const toggle = (opt) =>
    setSelected((prev) => prev.includes(opt) ? prev.filter((x) => x !== opt) : [...prev, opt])

  return (
    <Modal open onClose={onClose} title={`Trip ${row.trip_id} - Reason for No`} width={480}>
      <div className="modal-form">
        <div className="field">
          <label>
            Reason <span style={{ color: 'var(--danger)' }}>*</span>
          </label>
          <div className="rp-reason-checklist">
            {NO_REASON_OPTIONS.map((opt) => (
              <label key={opt} className="rp-reason-check">
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={() => toggle(opt)}
                />
                {opt}
              </label>
            ))}
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-square"
            disabled={busy || selected.length === 0}
            onClick={async () => {
              setBusy(true)
              await onContinue(selected.join(', '))
              setBusy(false)
            }}
          >
            {busy ? 'Working…' : 'Continue'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function ReasonPopup({ row, onClose }) {
  return (
    <Modal open onClose={onClose} title={`Trip ${row.trip_id} - Reason`} width={380}>
      <div className="modal-form">
        <p className="confirm-msg">{row.skip_reason}</p>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  )
}

function CancelPlanRideModal({ row, onClose, onConfirm }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = row.displayRef ?? row.ride?.ref_no ?? row.trip_id
  return (
    <Modal open onClose={onClose} title={`Cancel Ride · ${ref}`} width={420}>
      <div className="modal-form">
        <div className="field">
          <label htmlFor="rp-cancel-reason">Reason <span className="required">*</span></label>
          <textarea
            id="rp-cancel-reason"
            className="input"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. flight cancelled, vehicle unavailable…"
            autoFocus
          />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn btn-square btn-danger"
            disabled={busy || !reason.trim()}
            onClick={async () => {
              setBusy(true)
              await onConfirm(reason.trim())
              setBusy(false)
            }}
          >
            {busy ? 'Cancelling…' : 'Cancel Ride'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function SkipModal({ row, onClose, onSkip }) {
  const [selected, setSelected] = useState([])
  const [refNo, setRefNo] = useState('')
  const [busy, setBusy] = useState(false)
  const toggle = (opt) =>
    setSelected((s) => s.includes(opt) ? s.filter((x) => x !== opt) : [...s, opt])
  const reason = selected.join(', ')
  return (
    <Modal open onClose={onClose} title={`Trip ${row.trip_id} - Cancel`} width={480}>
      <div className="modal-form">
        <div className="field">
          <label>Reason <span className="required">*</span></label>
          <div className="rp-reason-checklist">
            {NO_REASON_OPTIONS.map((opt) => (
              <label key={opt} className="rp-reason-check">
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={() => toggle(opt)}
                />
                {opt}
              </label>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="skip-refno">Ride ID (optional)</label>
          <input
            id="skip-refno"
            className="input"
            inputMode="numeric"
            value={refNo}
            onChange={(e) => setRefNo(e.target.value.replace(/\D/g, ''))}
            placeholder="e.g. 1234 — if this trip was already dispatched separately"
          />
          <span className="field-hint">
            Link an already-created ride&rsquo;s ID — the row counts as followed and its Actual KM feeds the report.
          </span>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn btn-square"
            disabled={busy || (!refNo && !selected.length)}
            onClick={async () => {
              setBusy(true)
              await onSkip(reason, refNo)
              setBusy(false)
            }}
          >
            {busy ? 'Working…' : refNo ? 'Link ride' : 'Confirm'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function ImportModal({ allowedCities, flights, crew, vehicles, cityId, createdBy, onClose, onDone }) {
  const [parsed, setParsed] = useState(null) // { ok, skipped, warning }
  const [existing, setExisting] = useState(null) // { total, followed, dates } for dates this file also covers, or null
  const [replaceConfirmed, setReplaceConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const downloadSample = () => downloadCsv('ride-plan-sample.csv', toCsv(SAMPLE_COLS, SAMPLE))

  const onFile = async (e) => {
    setErr('')
    setParsed(null)
    setExisting(null)
    setReplaceConfirmed(false)
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const { headers, records } = parseCsvObjects(text)
    const hc = checkHeaders(headers, PLAN_REQUIRED_COLUMNS, PLAN_REQUIRED_COLUMNS)
    if (!hc.ok) return setErr(hc.error)
    const { ok, skipped } = buildPlanRows(records, { allowedCities, flights, crew, vehicles })
    setParsed({ ok, skipped, warning: hc.warning })

    // Re-uploading a file that covers dates already imported would otherwise
    // just ADD a second copy of every row (seq collides with the earlier
    // import's own 2.. numbering too, breaking the sheet-order display) -
    // check for that up front so the dispatcher can choose to replace.
    const dates = [...new Set(ok.map((r) => r.plan_date))]
    const cityIds = [...new Set(ok.map((r) => r.city_id))]
    if (dates.length && cityIds.length) {
      const { data: ex } = await supabase
        .from('ride_plan_rows')
        .select('plan_date, status')
        .in('plan_date', dates)
        .in('city_id', cityIds)
      if (ex?.length) {
        setExisting({
          total: ex.length,
          followed: ex.filter((r) => r.status === 'followed').length,
          dates,
          cityIds,
        })
      }
    }
  }

  const matchSummary = useMemo(() => {
    if (!parsed) return null
    let confirmed = 0
    let fuzzy = 0
    const unmatchedRows = []
    for (const r of parsed.ok) {
      for (const m of r.crew_matches) {
        if (m.tier === 'unmatched') unmatchedRows.push({ line: r.line, tripId: r.trip_id, raw: m.raw })
        else if (m.tier === 'fuzzy') fuzzy++
        else confirmed++
      }
    }
    return { confirmed, fuzzy, unmatched: unmatchedRows.length, unmatchedRows }
  }, [parsed])

  const runImport = async () => {
    if (!parsed?.ok.length) return
    if (existing && !replaceConfirmed) return
    setBusy(true)
    // the import batch's own city - the currently filtered city, else the most
    // common Base among the parsed rows (a plan can span more than one city)
    const counts = new Map()
    parsed.ok.forEach((r) => counts.set(r.city_id, (counts.get(r.city_id) || 0) + 1))
    const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    const importCityId = cityId ?? dominant

    if (existing) {
      const { error: delErr } = await supabase
        .from('ride_plan_rows')
        .delete()
        .in('plan_date', existing.dates)
        .in('city_id', existing.cityIds)
      if (delErr) {
        setBusy(false)
        return setErr(delErr.message)
      }
    }

    const { data: imp, error: impErr } = await supabase
      .from('ride_plan_imports')
      .insert({ city_id: importCityId, file_name: null, row_count: parsed.ok.length, created_by: createdBy ?? null })
      .select('id')
      .single()
    if (impErr) {
      setBusy(false)
      return setErr(impErr.message)
    }
    const { error } = await supabase
      .from('ride_plan_rows')
      .insert(parsed.ok.map(({ line, ...r }) => ({ ...r, seq: line, import_id: imp.id })))
    setBusy(false)
    if (error) return setErr(error.message)
    toast.success(`${parsed.ok.length} plan rows imported`)
    const earliestDate = parsed.ok.map((r) => r.plan_date).sort()[0]
    onDone(earliestDate)
  }

  return (
    <Modal open onClose={onClose} title="Upload Ride Plan" width={520}>
      <div className="modal-form">
        {err && <div className="modal-error">{err}</div>}

        <p className="confirm-msg">
          Upload the plan as a CSV (Save As → CSV from Excel) with columns{' '}
          <b>Date, Base, Car, Ad-hoc Car, Block Type, Trip ID, Flight No, Origin, Destination, Start
          Time, End Time, Distance (km), Crew Count, Crew</b>. Crew cells are matched to the Crew page
          by Employee No first, then by name.
        </p>

        <button type="button" className="btn btn-ghost btn-square btn-sm" onClick={downloadSample}>
          <Download size={13} /> Download sample
        </button>

        <div className="field">
          <label htmlFor="plan-file">CSV file</label>
          <input id="plan-file" type="file" accept=".csv,text/csv" className="input" onChange={onFile} />
        </div>

        {parsed && (
          <div className="import-summary">
            {parsed.warning && <div className="field-error">{parsed.warning}</div>}
            <b>{parsed.ok.length}</b> rows ready
            {matchSummary && (
              <>
                {' · crew: '}
                <b>{matchSummary.confirmed}</b> matched
                {matchSummary.fuzzy > 0 && (
                  <>
                    {', '}
                    <span className="status-text off">{matchSummary.fuzzy} fuzzy</span>
                  </>
                )}
                {matchSummary.unmatched > 0 && (
                  <>
                    {', '}
                    <span className="status-text bad">{matchSummary.unmatched} unmatched</span>
                    <ul className="import-skip-list">
                      {matchSummary.unmatchedRows.slice(0, 10).map((u, i) => (
                        <li key={i}>
                          Row {u.line} (Trip {u.tripId}): {u.raw}
                        </li>
                      ))}
                      {matchSummary.unmatchedRows.length > 10 && (
                        <li>…and {matchSummary.unmatchedRows.length - 10} more</li>
                      )}
                    </ul>
                  </>
                )}
              </>
            )}
            {parsed.skipped.length > 0 && (
              <>
                {' · '}
                <b>{parsed.skipped.length}</b> skipped
                <ul className="import-skip-list">
                  {parsed.skipped.slice(0, 10).map((s) => (
                    <li key={s.line}>
                      Row {s.line}: {s.reason}
                    </li>
                  ))}
                  {parsed.skipped.length > 10 && <li>…and {parsed.skipped.length - 10} more</li>}
                </ul>
              </>
            )}
          </div>
        )}

        {existing && (
          <div className="import-summary">
            <div className="modal-error">
              <b>{existing.total}</b> row(s) already exist for {existing.dates.length} date(s) this file
              covers{existing.followed ? ` — ${existing.followed} already Followed/No` : ''}. Importing will{' '}
              <b>replace</b> them (delete, then re-import), or Cancel and pick a different date range.
            </div>
            <label className="check-line" style={{ marginTop: 6 }}>
              <input
                type="checkbox"
                checked={replaceConfirmed}
                onChange={(e) => setReplaceConfirmed(e.target.checked)}
              />
              Yes, delete the {existing.total} existing row(s) and replace them
            </label>
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-square"
            disabled={busy || !parsed?.ok.length || (existing && !replaceConfirmed)}
            onClick={runImport}
          >
            {busy ? 'Importing…' : `Import ${parsed?.ok.length || 0}`}
          </button>
        </div>
      </div>
    </Modal>
  )
}
