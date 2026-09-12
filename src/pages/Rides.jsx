import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  CalendarRange,
  Download,
  Eye,
  MessageSquare,
  Navigation,
  Pencil,
  Plus,
  RefreshCw,
  Ban,
  RotateCcw,
  Route as RouteIcon,
  Send,
  Shield,
  Sigma,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { useCity } from '../context/useCity'
import { useEntityRows } from '../lib/useEntityRows'
import { useSelection } from '../lib/useSelection'
import { fmtDate } from '../lib/format'
import {
  addDays,
  fmtTime12,
  fmtTimeOnly12,
  isoToLocalDate,
  isoToLocalTime,
  pkToday,
  presetRange,
  toPkIso,
  toTime24,
} from '../lib/time'
import {
  BLOCK_TYPES,
  billableKm,
  blockExtraKm,
  blockLabel,
  buildRoutePoints,
  crewNamesText,
  crewRule,
  crewWaitMinutes,
  DEFAULT_CHECKIN_BUFFER_MIN,
  DEFAULT_CHECKOUT_BUFFER_MIN,
  DEFAULT_CREW_WAIT_BUFFER_MIN,
  DEFAULT_DEADHEAD_BUFFER_MIN,
  DEFAULT_RETURN_LEG_BUFFER_MIN,
  displayCrewCount,
  primaryTimeSlot,
  rideDriverText,
  rideTimeLabel,
  rideVehicleText,
  routeComplete,
  statusLabel,
} from '../lib/rideRoute'
import { gmapsRoute, optimizeCrewOrder, routeInfo } from '../lib/ors'
import { shiftLabel } from '../lib/shift'
import { downloadCsv, toCsv } from '../lib/csv'
import { distanceMeters, distanceToLineMeters, routeProgress } from '../lib/geo'
import { fetchLiveTracker } from '../lib/tracker'
import { notifyRide } from '../lib/notify'
import Modal from '../components/Modal'
import ConfirmDelete from '../components/ConfirmDelete'
import ConfirmDialog from '../components/ConfirmDialog'
import SearchSelect from '../components/SearchSelect'
import RouteMap from '../components/RouteMap'
import DataTable from '../components/data/DataTable'
import BulkDeleteBar from '../components/data/BulkDeleteBar'
import FilterBar from '../components/data/FilterBar'
import Pagination from '../components/data/Pagination'
import StatCards from '../components/data/StatCards'
import './Rides.css'

const PAGE_SIZE = 15
const BUFFER_MIN = 30 // turnaround buffer around a ride's road time (vehicle busy window)
// WhatsApp/SMS Notify - hidden from the UI until a real webhook provider
// (WhatsApp Business API / SMS gateway) is actually set up. The backend
// (notify-ride Edge Function, ride_notifications table, Settings ->
// Notifications) is untouched - flip this back on when ready, no other
// changes needed.
const NOTIFY_ENABLED = false

const SELECT = `
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

const EXPORT_COLS = [
  { key: 'ref_no', label: 'ID' },
  { key: 'ride_date', label: 'Date' },
  { key: 'duty_sheet', label: 'Duty Sheet' },
  { key: 'flight_no', label: 'Flight' },
  { key: 'flight_code', label: 'Code' },
  { key: 'block', label: 'Block' },
  { key: 'checkin_old', label: 'Check-in' },
  { key: 'checkin_new', label: 'Actual' },
  { key: 'checkout_old', label: 'Check-out' },
  { key: 'checkout_new', label: 'Actual' },
  { key: 'crew', label: 'Crew' },
  { key: 'crew_count', label: 'Count' },
  { key: 'origin', label: 'Origin' },
  { key: 'dest', label: 'Destination' },
  { key: 'vehicle', label: 'Vehicle' },
  { key: 'shift', label: 'Shift' },
  { key: 'driver', label: 'Driver' },
  { key: 'starts', label: 'Ride Time' },
  { key: 'eta', label: 'ETA' },
  { key: 'km', label: 'KM' },
  { key: 'extra_km', label: 'Extra KM' },
  { key: 'billable_km', label: 'Billable KM' },
  { key: 'status', label: 'Status' },
  { key: 'cancel_reason', label: 'Cancel reason' },
  { key: 'notes', label: 'Note' },
]

const DATE_PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'all', label: 'All' },
]

const etaOf = (startAt, durMin) =>
  startAt && durMin != null
    ? new Date(new Date(startAt).getTime() + durMin * 60000).toISOString()
    : null

// one paired field in the Ride View's left column (label stacked over value)
const RvField = ({ label, value }) => (
  <div className="rv-field">
    <span className="view-label">{label}</span>
    <span className="view-value">{value || '—'}</span>
  </div>
)

// Crew table cell: a single crew shows inline; 2+ stack one name per line
// (below, not extending sideways) so the row stays a sane width.
function CrewCell({ rc }) {
  const list = [...(rc || [])]
    .sort((a, b) => a.seq - b.seq)
    .map((x) => x.crew?.name)
    .filter(Boolean)
  if (!list.length) return '—'
  if (list.length === 1) return list[0]
  return (
    <div className="crew-cell-stack">
      {list.map((n, i) => (
        <div key={i}>{n}</div>
      ))}
    </div>
  )
}

// Check-in/Check-out table cell: the scheduled time, with the Actual time (if
// set) stacked below it - one column instead of two, table-only (export and
// the view modal keep them as separate Check-in/Actual columns/rows).
function CheckCell({ scheduled, actual }) {
  const s = fmtTime12(scheduled) || '—'
  const a = fmtTime12(actual)
  if (!a) return s
  return (
    <div className="crew-cell-stack">
      <div>{s}</div>
      <div className="secondary">{a}</div>
    </div>
  )
}

// Build a RideModal `initial` prefill from a Ride Plan row (see RidePlan.jsx /
// src/lib/planImport.js) - matches the plan's own crew/flight/vehicle
// resolutions against the arrays this page already has loaded.
function buildPlanInitial(planRow, { flights, crew, viaNo = false }) {
  const matchedFlight = planRow.matched_flight_id
    ? flights.find((f) => f.id === planRow.matched_flight_id)
    : null
  const slot = primaryTimeSlot(planRow.block_type)
  const crewList = (planRow.crew_matches || [])
    .map((m) => crew.find((c) => c.id === m.crew_id))
    .filter(Boolean)
  return {
    block_type: planRow.block_type,
    city_id: planRow.city_id,
    ride_date: planRow.plan_date,
    flight_id: matchedFlight?.id ?? '',
    flight_no: matchedFlight?.flight_no ?? planRow.flight_no ?? '',
    flight_code: matchedFlight?.flight_code ?? '',
    checkin_old: slot === 'checkin' ? toTime24(matchedFlight?.flight_time) : undefined,
    checkout_old: slot === 'checkout' ? toTime24(matchedFlight?.flight_time) : undefined,
    // The plan's own Ad-hoc Car flag (planImport skips fleet-matching for
    // these) carries straight over into the ride's own ad-hoc vehicle - same
    // concept, just previously two disconnected fields. Leaves
    // adhoc_vehicle_no unset - the Ride form assigns the next "Ad-Hoc NN"
    // for that city+date itself once the modal mounts with the box checked.
    vehicle_id: planRow.is_adhoc_car ? '' : planRow.matched_vehicle_id ?? '',
    is_adhoc_vehicle: Boolean(planRow.is_adhoc_car),
    start_time: toTime24(planRow.start_time),
    notes: viaNo ? `Plan trip ${planRow.trip_id} - dispatched despite "No"` : `Plan trip ${planRow.trip_id}`,
    crewList,
  }
}

export default function Rides() {
  const { can, profile } = useAuth()
  const { allowedCities, cityId, cityName } = useCity()
  const navigate = useNavigate()

  const canView = can('rides', 'view')
  const canAdd = can('rides', 'add')
  const canEdit = can('rides', 'edit')
  const canDelete = can('rides', 'delete')

  const { rows, loading, fetchRows } = useEntityRows({
    table: 'rides',
    select: SELECT,
    canView,
    label: 'rides',
  })

  // pickers
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
      .select('id, ref_no, name, stop_name, stop_lat, stop_lng, city_id, is_active')
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

  // Ride Plan hand-off: /rides?planRow=<id> opens the Add Ride modal
  // pre-filled from that plan row (see src/pages/RidePlan.jsx's "Follow").
  const [searchParams, setSearchParams] = useSearchParams()
  const [planPrefill, setPlanPrefill] = useState(null) // { initial, planRowId, pairedRowId }
  const clearPlanParam = () => {
    if (searchParams.get('planRow')) setSearchParams({}, { replace: true })
  }
  useEffect(() => {
    const planRowId = searchParams.get('planRow')
    if (!planRowId || !canView || flights.length === 0 || crew.length === 0) return
    let alive = true
    ;(async () => {
      const { data: planRow, error } = await supabase
        .from('ride_plan_rows')
        .select('*')
        .eq('id', planRowId)
        .single()
      if (!alive) return
      if (error || !planRow) {
        toast.error('That plan row could not be found')
        return clearPlanParam()
      }
      if (!canAdd) {
        toast.error('You do not have permission to add rides')
        return clearPlanParam()
      }
      // A paired Deadhead (off a Pickup) or Return Leg (off a Dropoff), still
      // pending - auto-check "Also create a Deadhead/Return Leg" so this one
      // Add covers both legs, same as the existing checkboxes already do for
      // a manually-dispatched pickup/dropoff. Paired by adjacent `seq`, NOT
      // Trip ID - the sheet's Trip ID on a Deadhead/Return Leg row names the
      // NEXT trip number this vehicle will run, not the one it's physically
      // tied to (confirmed against real data: a Deadhead is the row
      // immediately BEFORE its Pickup, a Return Leg immediately AFTER its
      // Dropoff - same Trip ID only coincides with that for the Deadhead
      // case, not the Return Leg one).
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
      const viaNo = searchParams.get('plan_no') === '1'
      const initial = buildPlanInitial(planRow, { flights, crew, viaNo })
      if (pairedRowId) {
        if (planRow.block_type === 'pickup') initial.alsoDeadhead = true
        else if (planRow.block_type === 'dropoff') initial.alsoReturnLeg = true
      }
      if (!alive) return
      setPlanPrefill({ initial, planRowId: planRow.id, pairedRowId, viaNo })
      setAddOpen(true)
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, canView, canAdd, flights, crew])

  const today = pkToday()
  const [page, setPage] = useState(1)
  // A ?q= from the sidebar's Cmd+K quick search seeds the search box AND
  // switches the date range to All - the default "Today" filter would
  // otherwise hide whatever the search was actually looking for if it
  // isn't dated today.
  const initialQ = searchParams.get('q') || ''
  const [search, setSearch] = useState(initialQ)
  const [blockFilter, setBlockFilter] = useState('all')
  // date range: driven by the Today/Week/Month/All tabs, or typed directly (then no tab is "on")
  const [datePreset, setDatePreset] = useState(initialQ ? 'all' : 'today')
  const [dateFrom, setDateFrom] = useState(initialQ ? '' : today)
  const [dateTo, setDateTo] = useState(initialQ ? '' : today)
  useEffect(() => {
    if (!initialQ) return
    const next = new URLSearchParams(searchParams)
    next.delete('q')
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [flightFilter, setFlightFilter] = useState('')
  const [vehicleFilter, setVehicleFilter] = useState('')
  const [shiftFilter, setShiftFilter] = useState('')
  const [driverFilter, setDriverFilter] = useState('')

  const [addOpen, setAddOpen] = useState(false)
  const [genOpen, setGenOpen] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [detail, setDetail] = useState(null) // { row, edit }
  const [noteFor, setNoteFor] = useState(null) // a ride row, for the note popup
  const [pending, setPending] = useState(null) // { ids, label }
  const [deleting, setDeleting] = useState(false)
  const [createRideFor, setCreateRideFor] = useState(null) // a dropoff ride - "Create Ride" (Return Leg / Deadhead)
  const [notifyFor, setNotifyFor] = useState(null) // a ride row - "Notify" confirm
  const [notifying, setNotifying] = useState(false)
  const [cancelFor, setCancelFor] = useState(null) // a ride row - "Cancel ride" modal
  const { selected, toggle, toggleAll, clear } = useSelection()

  const doNotify = async () => {
    if (!notifyFor) return
    setNotifying(true)
    const res = await notifyRide(notifyFor.id)
    setNotifying(false)
    setNotifyFor(null)
    if (res?.ok) toast.success(`Sent to ${res.recipients} recipient(s)`)
    else toast.error(res?.error || 'Could not send the notification')
  }

  const reinstateRide = async (r) => {
    const { error } = await supabase
      .from('rides')
      .update({ status: 'dispatched', cancel_reason: null, cancelled_at: null, cancelled_by: null, count_km: true })
      .eq('id', r.id)
    if (error) return toast.error(error.message)
    toast.success(`Ride ${r.display_ref} reinstated`)
    fetchRows()
  }

  // Today/Week/Month presets -> a concrete [dateFrom, dateTo]; "all" clears the range.
  // Typing a date directly (see the inputs below) sets datePreset back to '' (custom).
  const applyDatePreset = (p) => {
    const { from, to } = presetRange(p)
    setDatePreset(p)
    setPage(1)
    setDateFrom(from)
    setDateTo(to)
  }

  // "Create Ride" (on a dropoff ride) can chain up to 3 rides, each auto-
  // created FROM the one before it via return_of_ride_id, purely cosmetic
  // display suffixes over real, independent ref_no values:
  //   dropoff 1000 -> Return Leg  "1000-R"  (parent = the dropoff)
  //   dropoff 1000 -> Deadhead    "1000-D"  (parent = the dropoff)
  //   deadhead 1001 -> Pickup     "1001-P"  (parent = the deadhead, its own
  //                                          real ref_no, not "1000-D")
  // A dropoff ride can have AT MOST ONE follow-on ride, Return Leg OR
  // Deadhead (not both, not two of either) - once either exists, "Create
  // Ride" shows its details instead of the create form for both modes.
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows])
  const followOnByParent = useMemo(() => {
    const m = new Map()
    rows.forEach((r) => {
      if ((r.block_type === 'return_leg' || r.block_type === 'deadhead') && r.return_of_ride_id) {
        m.set(r.return_of_ride_id, r)
      }
    })
    return m
  }, [rows])
  //   pickup 1001  -> Deadhead   "1001-PD"  (parent = the pickup - the
  //                               "also create a deadhead" box on the Ride form)
  const suffixFor = (childBlock, parent) => {
    if (childBlock === 'return_leg') return 'R'
    if (childBlock === 'deadhead') return parent?.block_type === 'pickup' ? 'PD' : 'D'
    if (childBlock === 'pickup') return 'P'
    return null
  }
  // walk return_of_ride_id up to the top-most ancestor (the original dropoff)
  // so a companion Pickup chained off a Deadhead (dropoff -> deadhead ->
  // pickup, 2 hops) still displays against the dropoff's own ref_no, not the
  // deadhead's - "<dropoff ref>-D" AND "<dropoff ref>-P", never "<deadhead's
  // own ref>-P".
  const rootRefNo = (r) => {
    let cur = r
    let hops = 0
    while (cur?.return_of_ride_id && hops < 5) {
      const p = byId.get(cur.return_of_ride_id)
      if (!p) break
      cur = p
      hops++
    }
    return cur.ref_no
  }

  const list = useMemo(
    () =>
      rows.map((r) => {
        const parent = r.return_of_ride_id ? byId.get(r.return_of_ride_id) : null
        const suffix = parent ? suffixFor(r.block_type, parent) : null
        return {
          ...r,
          city_name: r.city?.name ?? '',
          crew_text: crewNamesText(r.ride_crew),
          crew_count: displayCrewCount(r.ride_crew, r.block_type),
          vehicle_text: rideVehicleText(r),
          display_ref: suffix ? `${rootRefNo(r)}-${suffix}` : String(r.ref_no),
          follow_on: followOnByParent.get(r.id) ?? null,
          // pre-duty_sheet_date rows (existing data) fall back to their own ride_date
          duty_sheet_display: r.duty_sheet_date || r.ride_date,
        }
      }),
    [rows, byId, followOnByParent],
  )

  // one ride against every filter; `dateField` says which of its dates the
  // date range applies to ('ride_date' for the table, 'duty_sheet_display'
  // for the Duty Sheet stat).
  const matchRide = (r, dateField) => {
    const s = search.trim().toLowerCase()
    if (blockFilter !== 'all' && r.block_type !== blockFilter) return false
    if (dateFrom && r[dateField] < dateFrom) return false
    if (dateTo && r[dateField] > dateTo) return false
    if (flightFilter && r.flight_id !== flightFilter) return false
    if (vehicleFilter && r.vehicle_id !== vehicleFilter) return false
    if (shiftFilter && r.shift !== shiftFilter) return false
    if (driverFilter && r.driver_id !== driverFilter) return false
    if (
      s &&
      !`${r.display_ref} ${r.flight_no ?? ''} ${r.flight_code ?? ''} ${r.crew_text} ${r.vehicle?.vehicle_no ?? ''} ${r.adhoc_vehicle_no ?? ''}`
        .toLowerCase()
        .includes(s)
    )
      return false
    return true
  }

  const filtered = useMemo(() => {
    return list.filter((r) => matchRide(r, 'ride_date'))
  }, [list, search, blockFilter, dateFrom, dateTo, flightFilter, vehicleFilter, shiftFilter, driverFilter])

  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // type-to-search filter option lists (Flight/Vehicle/Driver can get long)
  const flightFilterOpts = useMemo(
    () => [
      { value: '', label: 'All flights' },
      ...flights.map((f) => ({
        value: f.id,
        label: f.flight_no,
        sub: f.flight_code || undefined,
      })),
    ],
    [flights],
  )
  const vehicleFilterOpts = useMemo(
    () => [
      { value: '', label: 'All vehicles' },
      ...vehicles.map((v) => ({ value: v.id, label: v.vehicle_no })),
    ],
    [vehicles],
  )
  const driverFilterOpts = useMemo(
    () => [
      { value: '', label: 'All drivers' },
      ...drivers.map((d) => ({ value: d.id, label: `(${d.ref_no}) ${d.name}` })),
    ],
    [drivers],
  )

  const stats = useMemo(
    () => ({
      // rides in view (date range on ride_date + every other filter)
      total: filtered.length,
      // rides actually happening today, regardless of the filter
      today: list.filter((r) => r.ride_date === today).length,
      // rides whose Duty Sheet date is in the filtered range (+ other filters)
      // - for a plain day with no night-shift back-dating this equals `total`
      dutySheet: list.filter((r) => matchRide(r, 'duty_sheet_display')).length,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      list,
      filtered,
      today,
      search,
      blockFilter,
      dateFrom,
      dateTo,
      flightFilter,
      vehicleFilter,
      shiftFilter,
      driverFilter,
    ],
  )

  // Summary panel: the currently-filtered rides grouped by their Duty Sheet
  // date (newest first), with each date's ride count + KM total.
  const dutySheetSummary = useMemo(() => {
    const m = new Map()
    for (const r of filtered) {
      const cur = m.get(r.duty_sheet_display) || { count: 0, km: 0 }
      cur.count += 1
      cur.km += billableKm(r)
      m.set(r.duty_sheet_display, cur)
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [filtered])
  const summaryKm = useMemo(() => filtered.reduce((a, r) => a + billableKm(r), 0), [filtered])

  const doDelete = async () => {
    if (!pending) return
    setDeleting(true)
    const { error } = await supabase.from('rides').delete().in('id', pending.ids)
    setDeleting(false)
    if (error) return toast.error(error.message)
    toast.success(`Deleted ${pending.ids.length} ride(s)`)
    setPending(null)
    clear()
    fetchRows()
  }


  const exportCsv = () => {
    const data = filtered.map((r) => ({
      ref_no: r.display_ref,
      ride_date: r.ride_date,
      duty_sheet: r.duty_sheet_display,
      flight_no: r.flight_no ?? '',
      flight_code: r.flight_code ?? '',
      block: blockLabel(r.block_type),
      checkin_old: fmtTime12(r.checkin_old),
      checkin_new: fmtTime12(r.checkin_new),
      checkout_old: fmtTime12(r.checkout_old),
      checkout_new: fmtTime12(r.checkout_new),
      crew: r.crew_text,
      crew_count: r.crew_count,
      origin: r.origin_label ?? '',
      dest: r.dest_label ?? '',
      vehicle: r.is_adhoc_vehicle ? (r.adhoc_vehicle_no ?? '') + ' (ad-hoc)' : (r.vehicle?.vehicle_no ?? ''),
      shift: shiftLabel(r.shift),
      driver: rideDriverText(r),
      starts: r.start_at ? fmtTimeOnly12(r.start_at) : '',
      eta: fmtTimeOnly12(etaOf(r.start_at, r.duration_min)),
      km: r.distance_km != null ? Number(r.distance_km).toFixed(2) : '',
      extra_km: Number(r.extra_km) > 0 ? Number(r.extra_km).toFixed(2) : '',
      billable_km: billableKm(r) ? billableKm(r).toFixed(2) : '0',
      status: statusLabel(r.status),
      cancel_reason: r.cancel_reason ?? '',
      notes: r.notes ?? '',
    }))
    const tag = cityId == null ? 'all' : cityName.toLowerCase()
    downloadCsv(`rides-${tag}-${pkToday()}.csv`, toCsv(EXPORT_COLS, data))
    toast.success(`Exported ${data.length} row(s)`)
  }

  if (!canView) {
    return (
      <div className="page">
        <div className="card placeholder-card">
          <Shield size={28} color="var(--muted)" />
          <h2>No access</h2>
          <p>You don&rsquo;t have permission to view Rides.</p>
        </div>
      </div>
    )
  }

  const columns = [
    {
      key: 'ref',
      header: 'ID',
      render: (r) => (
        <span className="primary">
          {r.display_ref}
          {r.status === 'cancelled' && (
            <span
              style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: 'var(--danger)' }}
              title={r.cancel_reason || ''}
            >
              CANCELLED
            </span>
          )}
        </span>
      ),
    },
    { key: 'date', header: 'Date', render: (r) => fmtDate(r.ride_date) },
    { key: 'dutysheet', header: 'Duty Sheet', render: (r) => fmtDate(r.duty_sheet_display) },
    { key: 'fno', header: 'Flight', render: (r) => r.flight_no || '—' },
    { key: 'fcode', header: 'Code', render: (r) => r.flight_code || '—' },
    { key: 'block', header: 'Block', render: (r) => blockLabel(r.block_type) },
    {
      key: 'cio',
      header: 'Check-in',
      render: (r) => <CheckCell scheduled={r.checkin_old} actual={r.checkin_new} />,
    },
    {
      key: 'coo',
      header: 'Check-out',
      render: (r) => <CheckCell scheduled={r.checkout_old} actual={r.checkout_new} />,
    },
    { key: 'crew', header: 'Crew', render: (r) => <CrewCell rc={r.ride_crew} /> },
    { key: 'crewcount', header: 'Count', render: (r) => r.crew_count },
    { key: 'origin', header: 'Origin', render: (r) => r.origin_label || '—' },
    { key: 'dest', header: 'Destination', render: (r) => r.dest_label || '—' },
    { key: 'veh', header: 'Vehicle', render: (r) => r.vehicle_text },
    { key: 'shift', header: 'Shift', render: (r) => shiftLabel(r.shift) },
    { key: 'rdriver', header: 'Driver', render: (r) => rideDriverText(r) },
    {
      key: 'starts',
      header: 'Ride Time',
      render: (r) => (r.start_at ? fmtTimeOnly12(r.start_at) : '—'),
    },
    {
      key: 'eta',
      header: 'ETA',
      render: (r) => {
        if (!r.start_at || r.duration_min == null) return '—'
        return fmtTimeOnly12(new Date(new Date(r.start_at).getTime() + r.duration_min * 60000).toISOString())
      },
    },
    {
      key: 'km',
      header: 'KM',
      render: (r) => {
        if (r.distance_km == null) return '—'
        const notCounted = r.status === 'cancelled' && !r.count_km
        return (
          <span
            style={notCounted ? { textDecoration: 'line-through', color: 'var(--muted)' } : undefined}
            title={notCounted ? 'Cancelled — not counted in KM totals' : undefined}
          >
            {Number(r.distance_km).toFixed(2)}
          </span>
        )
      },
    },
    {
      key: 'actions',
      header: 'Action',
      align: 'right',
      render: (r) => {
        const gm = gmapsRoute(r.waypoints)
        return (
          <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
            {r.block_type === 'dropoff' && canAdd && (
              <button
                title={
                  r.follow_on
                    ? `Create Ride (${r.follow_on.block_type === 'deadhead' ? 'deadhead' : 'return leg'} already created)`
                    : 'Create Ride'
                }
                className={r.follow_on ? 'row-actions-note' : undefined}
                onClick={() => setCreateRideFor(r)}
              >
                <RotateCcw size={13} />
              </button>
            )}
            {gm && (
              <a
                className="row-actions-link"
                href={gm}
                target="_blank"
                rel="noreferrer"
                title="Open route in Google Maps"
              >
                <Navigation size={13} />
              </a>
            )}
            <button title="View" onClick={() => setDetail({ row: r, edit: false })}>
              <Eye size={13} />
            </button>
            {NOTIFY_ENABLED && canEdit && r.vehicle_id && r.status !== 'cancelled' && (
              <button title="Notify driver + crew" onClick={() => setNotifyFor(r)}>
                <Send size={13} />
              </button>
            )}
            {canEdit &&
              (r.status === 'cancelled' ? (
                <button
                  title={`Cancelled: ${r.cancel_reason || '—'} · click to reinstate`}
                  className="row-actions-note"
                  onClick={() => reinstateRide(r)}
                >
                  <Undo2 size={13} />
                </button>
              ) : (
                <button title="Cancel ride" className="danger" onClick={() => setCancelFor(r)}>
                  <Ban size={13} />
                </button>
              ))}
            {r.notes && (
              <button
                title={`Note: ${r.notes}`}
                className="row-actions-note"
                onClick={() => setNoteFor(r)}
              >
                <MessageSquare size={13} />
              </button>
            )}
            {canDelete && (
              <button
                title="Delete"
                className="danger"
                onClick={() =>
                  setPending({
                    ids: [r.id],
                    label: r.follow_on
                      ? `ride ${r.display_ref} and its ${r.follow_on.block_type === 'deadhead' ? 'deadhead' : 'return leg'} ${r.ref_no}-${suffixFor(r.follow_on.block_type, r)}`
                      : `ride ${r.display_ref}`,
                  })
                }
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        )
      },
    },
  ]

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Ride</h1>
          <p className="page-subtitle">
            {stats.total} ride(s) · {cityName}
          </p>
        </div>
        <div className="page-actions">
          <button className="icon-btn" onClick={fetchRows} title="Refresh">
            <RefreshCw size={15} />
          </button>
          <button
            className={`btn btn-ghost btn-square btn-sm${summaryOpen ? ' on' : ''}`}
            onClick={() => setSummaryOpen((v) => !v)}
          >
            <Sigma size={14} /> Summary
          </button>
          <button className="btn btn-ghost btn-square btn-sm" onClick={exportCsv}>
            <Download size={14} /> Export
          </button>
          {canAdd && (
            <button className="btn btn-ghost btn-square btn-sm" onClick={() => setGenOpen(true)}>
              <CalendarRange size={14} /> Generate
            </button>
          )}
          {canAdd && (
            <button className="btn" onClick={() => setAddOpen(true)}>
              <Plus size={15} /> Add Ride
            </button>
          )}
        </div>
      </div>

      <StatCards
        items={[
          { key: 'total', label: 'Total', value: stats.total, icon: RouteIcon },
          { key: 'today', label: 'Today', value: stats.today, icon: RouteIcon },
          { key: 'duty', label: 'Duty Sheet', value: stats.dutySheet, icon: RouteIcon },
        ]}
      />

      <FilterBar
        search={search}
        onSearch={(v) => {
          setSearch(v)
          setPage(1)
        }}
        searchPlaceholder="Search ID, flight, crew or vehicle..."
        activeCount={
          (blockFilter !== 'all' ? 1 : 0) +
          (datePreset !== 'today' ? 1 : 0) +
          (flightFilter ? 1 : 0) +
          (vehicleFilter ? 1 : 0) +
          (shiftFilter ? 1 : 0) +
          (driverFilter ? 1 : 0)
        }
        onClear={() => {
          setBlockFilter('all')
          applyDatePreset('today')
          setFlightFilter('')
          setVehicleFilter('')
          setShiftFilter('')
          setDriverFilter('')
          setSearch('')
          setPage(1)
        }}
        inline={
          <>
            <div className="date-tabs">
              {DATE_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className={datePreset === p.value ? 'on' : ''}
                  onClick={() => applyDatePreset(p.value)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <input
              type="date"
              className="filter-select"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value)
                setDatePreset('')
                setPage(1)
              }}
            />
            <span className="date-range-sep">–</span>
            <input
              type="date"
              className="filter-select"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value)
                setDatePreset('')
                setPage(1)
              }}
            />
            <select
              className="filter-select"
              value={blockFilter}
              onChange={(e) => {
                setBlockFilter(e.target.value)
                setPage(1)
              }}
            >
              <option value="all">All blocks</option>
              {BLOCK_TYPES.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
            <div className="filter-searchselect">
              <SearchSelect
                value={flightFilter}
                onChange={(v) => {
                  setFlightFilter(v)
                  setPage(1)
                }}
                options={flightFilterOpts}
                placeholder="All flights"
              />
            </div>
            <div className="filter-searchselect">
              <SearchSelect
                value={vehicleFilter}
                onChange={(v) => {
                  setVehicleFilter(v)
                  setPage(1)
                }}
                options={vehicleFilterOpts}
                placeholder="All vehicles"
              />
            </div>
            <div className="filter-searchselect">
              <SearchSelect
                value={driverFilter}
                onChange={(v) => {
                  setDriverFilter(v)
                  setPage(1)
                }}
                options={driverFilterOpts}
                placeholder="All drivers"
              />
            </div>
            <select
              className="filter-select"
              value={shiftFilter}
              onChange={(e) => {
                setShiftFilter(e.target.value)
                setPage(1)
              }}
            >
              <option value="">All shifts</option>
              <option value="day">{shiftLabel('day')}</option>
              <option value="night">{shiftLabel('night')}</option>
            </select>
          </>
        }
      />

      {summaryOpen && (
        <div className="rides-summary">
          <div className="rides-summary-head">
            <span>Summary</span>
            <span className="rides-summary-total">
              {filtered.length} ride(s) · {summaryKm.toLocaleString(undefined, { maximumFractionDigits: 1 })} km
            </span>
          </div>
          {dutySheetSummary.length === 0 ? (
            <span className="field-hint">No rides in the current filter.</span>
          ) : (
            <div className="rides-summary-grid">
              {dutySheetSummary.map(([d, v]) => (
                <div className="rides-summary-row" key={d}>
                  <span>{fmtDate(d)}</span>
                  <span>
                    {v.count} · {v.km.toLocaleString(undefined, { maximumFractionDigits: 1 })} km
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {canDelete && (
        <BulkDeleteBar
          count={selected.size}
          busy={deleting}
          onDelete={() => setPending({ ids: [...selected], label: `${selected.size} selected ride(s)` })}
          onClear={clear}
        />
      )}

      <DataTable
        columns={columns}
        rows={pageRows}
        rowKey={(r) => r.id}
        loading={loading}
        emptyLabel="No rides match these filters"
        selectable={canDelete}
        selected={selected}
        onToggle={toggle}
        onToggleAll={() => toggleAll(pageRows)}
        title="Rides"
        subtitle={`${filtered.length} shown`}
      />

      <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} />

      {addOpen && (
        <RideModal
          flights={flights}
          crew={crew}
          vehicles={vehicles}
          drivers={drivers}
          allowedCities={allowedCities}
          defaultCityId={cityId}
          createdBy={profile?.id}
          initial={planPrefill?.initial}
          onClose={() => {
            setAddOpen(false)
            setPlanPrefill(null)
            clearPlanParam()
          }}
          onDone={async (result) => {
            let planUpdateFailed = false
            if (planPrefill) {
              const upd = await supabase
                .from('ride_plan_rows')
                .update({ status: 'followed', ride_id: result?.rideId ?? null, via_no: planPrefill.viaNo ?? false })
                .eq('id', planPrefill.planRowId)
                .select('id')
              if (upd.error || !upd.data?.length) {
                planUpdateFailed = true
                toast.error(
                  upd.error?.message ||
                    'Ride created, but the Ride Plan row could not be updated (check your Ride Plan permissions).',
                )
              }
              const pairedRideId = result?.deadheadRideId ?? result?.returnLegRideId
              if (planPrefill.pairedRowId && pairedRideId) {
                const pairedUpd = await supabase
                  .from('ride_plan_rows')
                  .update({
                    status: 'followed',
                    ride_id: pairedRideId,
                    via_no: planPrefill.viaNo ?? false,
                  })
                  .eq('id', planPrefill.pairedRowId)
                  .select('id')
                if (pairedUpd.error || !pairedUpd.data?.length) {
                  toast.error(pairedUpd.error?.message || 'Ride created, but its paired Ride Plan row could not be updated.')
                }
              }
            }
            setAddOpen(false)
            setPlanPrefill(null)
            clearPlanParam()
            fetchRows()
            // Follow/No came from the Ride Plan page - go back to it so the
            // update is immediately visible, instead of leaving the
            // dispatcher on Rides wondering why the plan looks unchanged.
            if (planPrefill && !planUpdateFailed) navigate('/ride-plan')
          }}
        />
      )}
      {genOpen && (
        <GenerateRidesModal
          flights={flights}
          crew={crew}
          allowedCities={allowedCities}
          createdBy={profile?.id}
          onClose={() => setGenOpen(false)}
          onDone={() => {
            setGenOpen(false)
            fetchRows()
          }}
        />
      )}
      {detail && (
        <RideModal
          row={detail.row}
          startInEdit={detail.edit}
          canEdit={canEdit}
          flights={flights}
          crew={crew}
          vehicles={vehicles}
          drivers={drivers}
          allowedCities={allowedCities}
          createdBy={profile?.id}
          onClose={() => setDetail(null)}
          onDone={() => {
            setDetail(null)
            fetchRows()
          }}
        />
      )}
      {noteFor && <NotePopup row={noteFor} onClose={() => setNoteFor(null)} />}
      <ConfirmDialog
        open={Boolean(notifyFor)}
        title="Notify driver & crew"
        message={
          notifyFor
            ? `Send ride ${notifyFor.display_ref} details to its driver and crew via the ${notifyFor.city_name || 'city'} notification webhook?`
            : ''
        }
        confirmLabel="Send"
        busyLabel="Sending…"
        busy={notifying}
        onConfirm={doNotify}
        onClose={() => !notifying && setNotifyFor(null)}
      />
      {cancelFor && (
        <CancelRideModal
          row={cancelFor}
          cancelledBy={profile?.id}
          onClose={() => setCancelFor(null)}
          onDone={() => {
            setCancelFor(null)
            fetchRows()
          }}
        />
      )}
      {createRideFor && (
        <CreateRideModal
          row={createRideFor}
          flights={flights}
          crew={crew}
          vehicles={vehicles}
          allowedCities={allowedCities}
          createdBy={profile?.id}
          onClose={() => setCreateRideFor(null)}
          onView={(ride, label) => {
            setCreateRideFor(null)
            setDetail({ row: { ...ride, display_ref: label }, edit: false })
          }}
          onDone={() => {
            setCreateRideFor(null)
            fetchRows()
          }}
        />
      )}

      <ConfirmDelete
        open={Boolean(pending)}
        title="Delete ride"
        busy={deleting}
        message={pending ? `Permanently delete ${pending.label}? This cannot be undone.` : ''}
        onConfirm={doDelete}
        onClose={() => !deleting && setPending(null)}
      />
    </div>
  )
}

// ── Note popup ────────────────────────────────────────────────────────────
// Opened from the row-actions note icon. Deliberately minimal - just the
// three things asked for: Ride ID (as the modal title, same as the full
// view's header), Flight No, then the note itself.
function NotePopup({ row, onClose }) {
  return (
    <Modal open onClose={onClose} title={`Ride ${row.display_ref ?? row.ref_no}`} width={420}>
      <div className="modal-form">
        <div className="view-row">
          <span className="view-label">Flight</span>
          <span className="view-value">{row.flight_no || '—'}</span>
        </div>
        <div className="view-row">
          <span className="view-label">Note</span>
          <span className="view-value">{row.notes || '—'}</span>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Cancel ride ─────────────────────────────────────────────────────────
// Sets status = 'cancelled' + a reason. By default a cancelled ride drops out
// of KM totals (Dashboard / Summary); ticking "count this ride's KM anyway"
// keeps count_km = true so it still bills.
function CancelRideModal({ row, cancelledBy, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [countKm, setCountKm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!reason.trim()) return setErr('A reason is required')
    setBusy(true)
    const { error } = await supabase
      .from('rides')
      .update({
        status: 'cancelled',
        cancel_reason: reason.trim(),
        cancelled_at: new Date().toISOString(),
        cancelled_by: cancelledBy ?? null,
        count_km: countKm,
      })
      .eq('id', row.id)
    setBusy(false)
    if (error) return setErr(error.message)
    toast.success(`Ride ${row.display_ref} cancelled`)
    onDone()
  }

  return (
    <Modal open onClose={onClose} title={`Cancel ride ${row.display_ref}`} width={440}>
      <form className="modal-form" onSubmit={submit}>
        {err && <div className="modal-error">{err}</div>}
        <div className="field">
          <label htmlFor="cx-reason">Reason</label>
          <textarea
            id="cx-reason"
            className="input"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. flight cancelled, crew no-show, double booking…"
            autoFocus
          />
        </div>
        <label className="check-line">
          <input type="checkbox" checked={countKm} onChange={(e) => setCountKm(e.target.checked)} />
          Count this ride&rsquo;s {row.distance_km != null ? `${Number(row.distance_km).toFixed(2)} ` : ''}KM in
          reports anyway
        </label>
        <span className="field-hint">
          Left unticked, the cancelled ride shows a struck-through KM and is excluded from every KM total.
        </span>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
            Keep ride
          </button>
          <button type="submit" className="btn btn-square btn-danger" disabled={busy}>
            {busy ? 'Cancelling…' : 'Cancel ride'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Create Ride (Return Leg / Deadhead) ──────────────────────────────────
// Opened from the "Create Ride" row action on a dropoff ride. Two modes:
//   Return Leg - unchanged from before: last-dropped crew's stop -> Airport,
//     same vehicle/shift, no ride_crew row (empty repositioning). At most
//     one per dropoff ride - if it already exists this tab shows it instead
//     of the create form, with a "View return leg" shortcut.
//   Deadhead - last-dropped crew's stop -> a newly picked crew's stop (both
//     as ride_crew, deadhead_mode 'crew'), same vehicle/shift, a flight is
//     required (snapshotted so the deadhead can be tied to it - if that
//     flight is itself a pickup/dropoff, its check-in/out auto-fills the
//     same way flight-pick does in the main Ride form). Displays as
//     "<dropoff ref>-D". An optional "Create Pickup" checkbox additionally
//     creates a companion Pickup ride (that same new crew -> Airport, its
//     own flight) chained off the Deadhead - displays as
//     "<deadhead's own ref_no>-P".
// Both auto-legs' Ride Time = the dropoff ride's own ETA (arrival at the
// crew stop) + that city's Return Leg / Deadhead buffer (Settings -> Ride
// Buffer Time) - no manual time entry, same pattern for both.
function CreateRideModal({ row, flights, crew, vehicles, allowedCities, createdBy, onClose, onView, onDone }) {
  const [mode, setMode] = useState('return')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const cityObj = allowedCities.find((c) => c.id === row.city_id)
  const lastCrew = [...(row.ride_crew || [])].sort((a, b) => a.seq - b.seq).pop()?.crew
  const airport = { name: row.airport_name, lat: Number(row.airport_lat), lng: Number(row.airport_lng) }

  // this dropoff ride's own arrival at the crew stop it dropped off at -
  // both Return Leg and Deadhead start counting their buffer from here
  const origEtaMs =
    row.start_at && row.duration_min != null
      ? new Date(row.start_at).getTime() + row.duration_min * 60000
      : null

  // Same vehicle info as the parent dropoff ride - including an ad-hoc
  // (rented) vehicle's number, not just a real vehicle_id. Same ad-hoc car
  // doing this follow-on leg, so it keeps the same "Ad-Hoc NN", not a new one.
  const sameVehicleFields = (shift) => {
    const veh = row.is_adhoc_vehicle ? null : vehicles.find((v) => v.id === row.vehicle_id)
    const driverId = veh ? (shift === 'night' ? veh.night_driver_id : veh.driver_id) : null
    const hasV = row.is_adhoc_vehicle || Boolean(row.vehicle_id)
    return {
      vehicle_id: row.is_adhoc_vehicle ? null : row.vehicle_id,
      shift: hasV ? shift : null,
      driver_id: driverId || null,
      is_adhoc_vehicle: row.is_adhoc_vehicle,
      adhoc_vehicle_no: row.is_adhoc_vehicle ? row.adhoc_vehicle_no : null,
      adhoc_driver_name: null,
      adhoc_driver_phone: null,
    }
  }

  const startAtFrom = (bufferMin) =>
    origEtaMs != null
      ? new Date(origEtaMs + bufferMin * 60000).toISOString()
      : row.end_at || toPkIso(row.ride_date, row.checkout_new || row.checkout_old || '12:00')

  // ── Return Leg (unchanged behaviour) ──────────────────────────────────
  const doReturnLeg = async () => {
    if (!lastCrew) return setErr('This ride has no crew to return')
    setErr('')
    setBusy(true)
    try {
      const pts = buildRoutePoints('return_leg', null, [{ ...lastCrew, crew_id: lastCrew.id }], airport)
      const info = routeComplete(pts) ? await routeInfo(pts.map((p) => [p.lng, p.lat])) : null
      const returnBufferMin = Number.isFinite(Number(cityObj?.return_leg_buffer_min))
        ? Number(cityObj.return_leg_buffer_min)
        : DEFAULT_RETURN_LEG_BUFFER_MIN
      const start_at = startAtFrom(returnBufferMin)
      const dur = (info?.durationMin ?? 30) + BUFFER_MIN
      const end_at = start_at ? new Date(new Date(start_at).getTime() + dur * 60000).toISOString() : null
      const shift = row.shift || 'day'
      const legRideDate = start_at ? isoToLocalDate(start_at) : row.ride_date

      // the return leg carries no passenger - it's the vehicle running empty
      // back to the airport - so its Count always displays 0 (see the `list`
      // memo and the view modal above), regardless of ride_crew. It still
      // gets a single ride_crew row below, purely so the Crew column/export/
      // view can show WHOSE stop it originated from.
      const { data: created, error } = await supabase
        .from('rides')
        .insert({
          city_id: row.city_id,
          flight_id: row.flight_id,
          flight_no: row.flight_no,
          flight_code: row.flight_code,
          block_type: 'return_leg',
          ride_date: legRideDate,
          duty_sheet_date: legRideDate,
          ...sameVehicleFields(shift),
          airport_name: airport.name,
          airport_lat: airport.lat,
          airport_lng: airport.lng,
          origin_label: pts[0]?.label,
          origin_lat: pts[0]?.lat,
          origin_lng: pts[0]?.lng,
          dest_label: pts[1]?.label,
          dest_lat: pts[1]?.lat,
          dest_lng: pts[1]?.lng,
          waypoints: pts,
          route_geometry: info?.line ?? null,
          distance_km: info?.distanceKm ?? null,
          duration_min: info?.durationMin ?? null,
          start_at,
          end_at,
          status: 'dispatched',
          return_of_ride_id: row.id,
          created_by: createdBy ?? null,
        })
        .select('id')
        .single()
      if (error) throw new Error(mapRideError(error, row.vehicle_id, vehicles))
      await supabase.from('ride_crew').insert({ ride_id: created.id, crew_id: lastCrew.id, seq: 0 })
      toast.success('Return leg ride created')
      onDone()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  // ── Deadhead (+ optional companion Pickup) ────────────────────────────
  const cityCrew = crew.filter((c) => c.city_id === row.city_id)
  const cityFlights = flights.filter((f) => f.city_id === row.city_id)
  const [destCrewId, setDestCrewId] = useState('')
  const [flightId, setFlightId] = useState('')
  const [addPickup, setAddPickup] = useState(false)
  const [pickupFlightId, setPickupFlightId] = useState('')
  const [pickupCheckinNew, setPickupCheckinNew] = useState('')

  const destCrew = cityCrew.find((c) => c.id === destCrewId)
  const flight = cityFlights.find((f) => f.id === flightId)
  const flightSlot = primaryTimeSlot(flight?.block_type) // 'checkin' | 'checkout' | null
  const pickupFlight = cityFlights.find((f) => f.id === pickupFlightId)

  const pickFlight = (fid) => setFlightId(fid)

  const [dhInfo, setDhInfo] = useState(null) // { distanceKm, durationMin }
  useEffect(() => {
    if (!lastCrew || !destCrew) {
      setDhInfo(null)
      return
    }
    const pts = buildRoutePoints(
      'deadhead',
      'crew',
      [{ ...lastCrew, crew_id: lastCrew.id }, { ...destCrew, crew_id: destCrew.id }],
      airport,
    )
    if (!routeComplete(pts)) {
      setDhInfo(null)
      return
    }
    let alive = true
    routeInfo(pts.map((p) => [p.lng, p.lat])).then((info) => {
      if (alive) setDhInfo(info)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destCrewId])

  const deadheadBufferMin = Number.isFinite(Number(cityObj?.deadhead_buffer_min))
    ? Number(cityObj.deadhead_buffer_min)
    : DEFAULT_DEADHEAD_BUFFER_MIN
  const dhStartAt = startAtFrom(deadheadBufferMin)
  const dhEta =
    dhStartAt && dhInfo?.durationMin != null
      ? new Date(new Date(dhStartAt).getTime() + dhInfo.durationMin * 60000).toISOString()
      : null

  const doDeadhead = async (e) => {
    e.preventDefault()
    setErr('')
    if (!lastCrew) return setErr('This ride has no crew to deadhead from')
    if (!destCrew) return setErr('Pick a destination crew')
    if (!flight) return setErr('Pick a flight')
    if (addPickup && !pickupFlight) return setErr('Pick a flight for the Pickup ride')
    setBusy(true)
    try {
      const pts = buildRoutePoints(
        'deadhead',
        'crew',
        [{ ...lastCrew, crew_id: lastCrew.id }, { ...destCrew, crew_id: destCrew.id }],
        airport,
      )
      const info = dhInfo ?? (routeComplete(pts) ? await routeInfo(pts.map((p) => [p.lng, p.lat])) : null)
      const start_at = dhStartAt
      const dur = (info?.durationMin ?? 30) + BUFFER_MIN
      const end_at = start_at ? new Date(new Date(start_at).getTime() + dur * 60000).toISOString() : null
      const shift = row.shift || 'day'
      const ft = toTime24(flight.flight_time)
      const legRideDate = start_at ? isoToLocalDate(start_at) : row.ride_date

      const { data: dh, error } = await supabase
        .from('rides')
        .insert({
          city_id: row.city_id,
          flight_id: flight.id,
          flight_no: flight.flight_no,
          flight_code: flight.flight_code || null,
          block_type: 'deadhead',
          deadhead_mode: 'crew',
          ride_date: legRideDate,
          duty_sheet_date: legRideDate,
          checkin_old: flightSlot === 'checkin' ? ft || null : null,
          checkin_new: flightSlot === 'checkin' ? ft || null : null,
          checkout_old: flightSlot === 'checkout' ? ft || null : null,
          checkout_new: flightSlot === 'checkout' ? ft || null : null,
          ...sameVehicleFields(shift),
          airport_name: airport.name,
          airport_lat: airport.lat,
          airport_lng: airport.lng,
          origin_label: pts[0]?.label,
          origin_lat: pts[0]?.lat,
          origin_lng: pts[0]?.lng,
          dest_label: pts[1]?.label,
          dest_lat: pts[1]?.lat,
          dest_lng: pts[1]?.lng,
          waypoints: pts,
          route_geometry: info?.line ?? null,
          distance_km: info?.distanceKm ?? null,
          duration_min: info?.durationMin ?? null,
          start_at,
          end_at,
          status: 'dispatched',
          return_of_ride_id: row.id,
          created_by: createdBy ?? null,
        })
        .select('id, ref_no')
        .single()
      if (error) throw new Error(mapRideError(error, row.vehicle_id, vehicles))

      await supabase.from('ride_crew').insert([
        { ride_id: dh.id, crew_id: lastCrew.id, seq: 0 },
        { ride_id: dh.id, crew_id: destCrew.id, seq: 1 },
      ])

      if (addPickup) {
        const pPts = buildRoutePoints('pickup', null, [{ ...destCrew, crew_id: destCrew.id }], airport)
        const pInfo = routeComplete(pPts) ? await routeInfo(pPts.map((p) => [p.lng, p.lat])) : null
        const pft = toTime24(pickupFlight.flight_time)
        const pCheckinOld = pft || null
        const pCheckinNewVal = pickupCheckinNew || pft || null

        // same auto-suggest formula as the main Ride form's Pickup Time
        const checkinBufferMin = Number.isFinite(Number(cityObj?.checkin_buffer_min))
          ? Number(cityObj.checkin_buffer_min)
          : DEFAULT_CHECKIN_BUFFER_MIN
        const anchor = pCheckinNewVal || pCheckinOld
        let pStartAt = null
        if (anchor) {
          const [h, m] = anchor.split(':').map(Number)
          const mins = h * 60 + m - checkinBufferMin - (pInfo?.durationMin ?? 0)
          const v = ((mins % 1440) + 1440) % 1440
          const t = `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`
          pStartAt = toPkIso(legRideDate, t)
        }
        const pDur = (pInfo?.durationMin ?? 30) + BUFFER_MIN
        const pEndAt = pStartAt ? new Date(new Date(pStartAt).getTime() + pDur * 60000).toISOString() : null
        const pRideDate = pStartAt ? isoToLocalDate(pStartAt) : legRideDate
        const pExtraKm = blockExtraKm('pickup', cityObj)

        const { data: pr, error: pErr } = await supabase
          .from('rides')
          .insert({
            city_id: row.city_id,
            flight_id: pickupFlight.id,
            flight_no: pickupFlight.flight_no,
            flight_code: pickupFlight.flight_code || null,
            block_type: 'pickup',
            ride_date: pRideDate,
            duty_sheet_date: pRideDate,
            checkin_old: pCheckinOld,
            checkin_new: pCheckinNewVal,
            ...sameVehicleFields(shift),
            airport_name: airport.name,
            airport_lat: airport.lat,
            airport_lng: airport.lng,
            origin_label: pPts[0]?.label,
            origin_lat: pPts[0]?.lat,
            origin_lng: pPts[0]?.lng,
            dest_label: pPts[1]?.label,
            dest_lat: pPts[1]?.lat,
            dest_lng: pPts[1]?.lng,
            waypoints: pPts,
            route_geometry: pInfo?.line ?? null,
            distance_km: pInfo ? pInfo.distanceKm + pExtraKm : null,
            extra_km: pInfo ? pExtraKm : 0,
            duration_min: pInfo?.durationMin ?? null,
            start_at: pStartAt,
            end_at: pEndAt,
            status: 'dispatched',
            return_of_ride_id: dh.id,
            created_by: createdBy ?? null,
          })
          .select('id')
          .single()
        if (pErr) throw new Error(mapRideError(pErr, row.vehicle_id, vehicles))
        await supabase.from('ride_crew').insert({ ride_id: pr.id, crew_id: destCrew.id, seq: 0 })
        toast.success(`Deadhead + Pickup rides created (${row.ref_no}-D, ${row.ref_no}-P)`)
      } else {
        toast.success(`Deadhead ride created (${row.ref_no}-D)`)
      }
      onDone()
    } catch (e2) {
      setErr(e2.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Create Ride from ${row.display_ref}`} width={620}>
      <div className="modal-form">
        {row.follow_on ? (
          <>
            <p className="confirm-msg">
              {row.follow_on.block_type === 'deadhead' ? 'A deadhead' : 'A return leg'} has already been created
              for this ride - only one follow-on ride (Return Leg or Deadhead) is allowed per dropoff.
            </p>
            <div className="view-row">
              <span className="view-label">{row.follow_on.block_type === 'deadhead' ? 'Deadhead' : 'Return Leg'}</span>
              <span className="view-value">
                {row.ref_no}-{row.follow_on.block_type === 'deadhead' ? 'D' : 'R'}
              </span>
            </div>
            <div className="view-row">
              <span className="view-label">Date</span>
              <span className="view-value">{fmtDate(row.follow_on.ride_date)}</span>
            </div>
            <div className="view-row">
              <span className="view-label">Ride Time</span>
              <span className="view-value">
                {row.follow_on.start_at ? fmtTimeOnly12(row.follow_on.start_at) : '—'}
              </span>
            </div>
            <div className="view-row">
              <span className="view-label">Vehicle</span>
              <span className="view-value">{row.follow_on.vehicle?.vehicle_no || '—'}</span>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
                Close
              </button>
              <button
                type="button"
                className="btn btn-square"
                onClick={() =>
                  onView(row.follow_on, `${row.ref_no}-${row.follow_on.block_type === 'deadhead' ? 'D' : 'R'}`)
                }
              >
                View {row.follow_on.block_type === 'deadhead' ? 'deadhead' : 'return leg'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="date-tabs">
              <button
                type="button"
                className={mode === 'return' ? 'on' : ''}
                onClick={() => {
                  setMode('return')
                  setErr('')
                }}
              >
                Return Leg
              </button>
              <button
                type="button"
                className={mode === 'deadhead' ? 'on' : ''}
                onClick={() => {
                  setMode('deadhead')
                  setErr('')
                }}
              >
                Deadhead
              </button>
            </div>

            {err && <div className="modal-error">{err}</div>}

            {mode === 'return' ? (
              <>
                <p className="confirm-msg">
                  Create a return-leg ride: {row.dest_label || 'last stop'} → {row.airport_name || 'Airport'}, on
                  the same vehicle ({row.vehicle?.vehicle_no || '—'}).
                </p>
                <div className="modal-actions">
                  <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
                    Cancel
                  </button>
                  <button type="button" className="btn btn-square" disabled={busy} onClick={doReturnLeg}>
                    {busy ? 'Creating…' : 'Create return ride'}
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={doDeadhead}>
                <p className="confirm-msg">
                  Deadhead: {lastCrew ? lastCrew.stop_name || lastCrew.name : 'last stop'} (where{' '}
                  {row.display_ref} dropped off) → a new crew, on the same vehicle (
                  {row.vehicle?.vehicle_no || '—'}).
                </p>

                <div className="field">
                  <label>Destination crew</label>
                  <SearchSelect
                    value={destCrewId}
                    onChange={setDestCrewId}
                    options={cityCrew
                      .filter((c) => c.id !== lastCrew?.id)
                      .map((c) => ({ value: c.id, label: `(${c.ref_no}) ${c.name}`, sub: c.stop_name || undefined }))}
                    placeholder="Search a crew member…"
                  />
                </div>

                <div className="field">
                  <label>Flight</label>
                  <SearchSelect
                    value={flightId}
                    onChange={pickFlight}
                    options={cityFlights.map((f) => ({
                      value: f.id,
                      label: `${f.flight_no}${f.flight_code ? ' · ' + f.flight_code : ''}`,
                      sub: f.route || undefined,
                    }))}
                    placeholder="Search a flight…"
                  />
                  <span className="field-hint">
                    Snapshotted onto the deadhead so it&rsquo;s clear which flight it was for.
                  </span>
                </div>

                <div className="field">
                  <label>
                    Route{' '}
                    {dhInfo?.distanceKm != null && (
                      <span className="ride-km-badge">
                        {Number(dhInfo.distanceKm).toFixed(2)} km
                        {dhInfo.durationMin != null ? ` · ${dhInfo.durationMin} min` : ''}
                      </span>
                    )}
                  </label>
                  <span className="field-hint">
                    Ride Time {fmtTimeOnly12(dhStartAt) || '—'} (dropoff arrival + {deadheadBufferMin} min Deadhead
                    buffer) · {destCrew?.name || 'Destination crew'}&rsquo;s ETA{' '}
                    {dhEta ? fmtTimeOnly12(dhEta) : 'needs a route'}
                  </span>
                </div>

                <label className="check-line">
                  <input type="checkbox" checked={addPickup} onChange={(e) => setAddPickup(e.target.checked)} />
                  Also create a Pickup ride for this crew ({destCrew?.name || 'destination crew'} → Airport)
                </label>

                {addPickup && (
                  <>
                    <div className="field">
                      <label>Pickup flight</label>
                      <SearchSelect
                        value={pickupFlightId}
                        onChange={setPickupFlightId}
                        options={cityFlights.map((f) => ({
                          value: f.id,
                          label: `${f.flight_no}${f.flight_code ? ' · ' + f.flight_code : ''}`,
                          sub: f.route || undefined,
                        }))}
                        placeholder="Search a flight…"
                      />
                    </div>
                    <div className="field-row">
                      <div className="field">
                        <label htmlFor="pk-cio">Check-in</label>
                        <input
                          id="pk-cio"
                          type="time"
                          className="input"
                          value={toTime24(pickupFlight?.flight_time)}
                          disabled
                        />
                        <span className="field-hint">Scheduled, from the flight</span>
                      </div>
                      <div className="field">
                        <label htmlFor="pk-cin">Actual</label>
                        <input
                          id="pk-cin"
                          type="time"
                          className="input"
                          value={pickupCheckinNew}
                          onChange={(e) => setPickupCheckinNew(e.target.value)}
                        />
                      </div>
                    </div>
                  </>
                )}

                <div className="modal-actions">
                  <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-square" disabled={busy}>
                    {busy ? 'Creating…' : 'Create Deadhead'}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

// ── Live Tracking (Ride view) ─────────────────────────────────────────────
// Overlays a ride's own vehicle's live position (vehicles.tracker_url, that
// vehicle's own AI Track sharing link - distinct from cities.tracker_url,
// the fleet map on the Tracker page) on its route map, plus a few signals
// derived purely client-side from that one poll (no ORS calls involved):
//   - On time / Running late: now vs the ride's own ETA, unless the vehicle
//     is already within ARRIVED_M of the destination
//   - Off route: perpendicular distance from the live fix to route_geometry
//   - Over speed: live speed vs a flat SPEED_LIMIT_KPH (not read from the
//     tracker service - it doesn't expose a speed-limit/geofence config
//     through the sharing link, only the live fix itself)
// Polls fetchLiveTracker() every LIVE_POLL_MS while this card is mounted
// (i.e. while the View modal is open) and stops on close/unmount.
const LIVE_POLL_MS = 8000
const ARRIVED_M = 300
const OFF_ROUTE_M = 500
const SPEED_LIMIT_KPH = 100
const LIVE_STATUS_LABEL = { green: 'Moving', red: 'Stopped', blue: 'Offline', yellow: 'Engine on' }
const LIVE_STATUS_BADGE = { green: 'badge-success', blue: 'badge-warning', yellow: 'badge-warning' }

// AI Track timestamps come through as a number (unix s or ms) or a string
// ("2026-09-08 14:32:05" / ISO) - be tolerant, fall back to null.
const parseTrackerTs = (ts) => {
  if (ts == null || ts === '') return null
  if (typeof ts === 'number') return new Date(ts < 1e12 ? ts * 1000 : ts)
  let d = new Date(ts)
  if (!Number.isNaN(d.getTime())) return d
  d = new Date(String(ts).replace(' ', 'T'))
  return Number.isNaN(d.getTime()) ? null : d
}

function LiveTrackingCard({ row, mapHeight = 200 }) {
  const trackerUrl = row.vehicle.tracker_url
  const [live, setLive] = useState(null)
  const [checked, setChecked] = useState(false)
  // stops the vehicle has been seen at WHILE this card is open: seq -> Date.
  // Session-only - a persisted per-ride history is the future "AI Tracker
  // system" (see memory). Uses the tracker fix's own timestamp when it parses.
  const [passedAt, setPassedAt] = useState({})

  const waypoints = useMemo(
    () =>
      [...(row.waypoints || [])]
        .filter((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)))
        .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)),
    [row.waypoints],
  )

  useEffect(() => {
    let alive = true
    const poll = async () => {
      const p = await fetchLiveTracker(trackerUrl)
      if (!alive) return
      setLive(p)
      setChecked(true)
      if (p) {
        const at = parseTrackerTs(p.timestamp) || new Date()
        setPassedAt((prev) => {
          let next = prev
          waypoints.forEach((w, i) => {
            if (next[i] != null) return
            if (distanceMeters(p.lat, p.lng, Number(w.lat), Number(w.lng)) <= ARRIVED_M) {
              if (next === prev) next = { ...prev }
              next[i] = at
            }
          })
          return next
        })
      }
    }
    poll()
    const id = setInterval(poll, LIVE_POLL_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [trackerUrl, waypoints])

  if (!checked) return <div className="field-hint">Checking live position…</div>
  if (!live) return <div className="field-hint">No live signal from this vehicle right now.</div>

  const destLat = Number(row.dest_lat)
  const destLng = Number(row.dest_lng)
  const distToDestM =
    Number.isFinite(destLat) && Number.isFinite(destLng)
      ? distanceMeters(live.lat, live.lng, destLat, destLng)
      : null
  const arrived = distToDestM != null && distToDestM <= ARRIVED_M

  const prog = row.route_geometry?.length > 1 ? routeProgress(live.lat, live.lng, row.route_geometry) : null
  const remainKm = prog ? prog.aheadM / 1000 : distToDestM != null ? distToDestM / 1000 : null
  const plannedKph =
    row.distance_km && row.duration_min ? Number(row.distance_km) / (Number(row.duration_min) / 60) : null
  // use the live speed while genuinely moving, else the planned average
  const speedKph = live.speed > 4 ? live.speed : plannedKph || 25
  const etaMin = remainKm != null ? Math.round((remainKm / speedKph) * 60) : null
  const liveEtaAt = etaMin != null ? new Date(Date.now() + etaMin * 60000) : null

  const plannedEtaAt =
    row.start_at && row.duration_min != null
      ? new Date(new Date(row.start_at).getTime() + row.duration_min * 60000)
      : null
  const late = !arrived && plannedEtaAt != null && Date.now() > plannedEtaAt.getTime()

  const offRouteM =
    row.route_geometry?.length > 1 ? distanceToLineMeters(live.lat, live.lng, row.route_geometry) : null
  const offRoute = offRouteM != null && offRouteM > OFF_ROUTE_M
  const overSpeed = live.speed > SPEED_LIMIT_KPH

  const fixAt = parseTrackerTs(live.timestamp)
  const passedRows = Object.entries(passedAt)
    .map(([i, at]) => ({ i: Number(i), at, w: waypoints[Number(i)] }))
    .sort((a, b) => a.at - b.at)

  return (
    <div className="live-track">
      <div className="live-track-badges">
        <span className={`badge ${LIVE_STATUS_BADGE[live.status] || ''}`}>
          {LIVE_STATUS_LABEL[live.status] || 'Unknown'} · {live.speed} kph
        </span>
        {arrived ? (
          <span className="badge badge-success">Arrived</span>
        ) : (
          liveEtaAt && (
            <span className="badge badge-accent">
              Arrives ~{fmtTimeOnly12(liveEtaAt.toISOString())}
              {etaMin != null ? ` · in ${etaMin} min` : ''}
              {remainKm != null ? ` · ${remainKm.toFixed(1)} km left` : ''}
            </span>
          )
        )}
        {late && <span className="badge badge-warning">Behind planned ETA</span>}
        {offRoute && <span className="badge badge-warning">Off route ({(offRouteM / 1000).toFixed(1)} km)</span>}
        {overSpeed && <span className="badge badge-danger">Over speed</span>}
      </div>
      <RouteMap
        points={row.waypoints || []}
        line={row.route_geometry}
        totalKm={row.distance_km != null ? Number(row.distance_km) : undefined}
        liveMarker={live}
        height={mapHeight}
      />
      <div className="live-track-foot">
        {live.address && <span className="field-hint">{live.address}</span>}
        {fixAt && <span className="field-hint">Last fix {fmtTimeOnly12(fixAt.toISOString())}</span>}
      </div>
      {passedRows.length > 0 && (
        <div className="live-track-passed">
          <span className="live-track-passed-head">Seen at stops (this session)</span>
          {passedRows.map(({ i, at, w }) => (
            <div className="live-track-passed-row" key={i}>
              <span>
                {i === 0 ? 'A' : i === waypoints.length - 1 ? 'B' : i}
                {w?.label ? ` · ${w.label}` : ''}
              </span>
              <span>{fmtTimeOnly12(at.toISOString())}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Trip playback (AI Tracker) ───────────────────────────────────────────
// The recorded GPS path for this ride (public.ride_track_points, written by
// the `track-rides` Edge Function while the ride was active), played back over
// the planned route_geometry. Shows only when there are points.
function TripPlayback({ row, mapHeight = 200 }) {
  const [pts, setPts] = useState(null) // [{ at, lat, lng, speed }]
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    let alive = true
    supabase
      .from('ride_track_points')
      .select('at, lat, lng, speed')
      .eq('ride_id', row.id)
      .order('at', { ascending: true })
      .then(({ data }) => {
        if (!alive) return
        const clean = (data ?? [])
          .map((p) => ({ at: p.at, lat: Number(p.lat), lng: Number(p.lng), speed: Number(p.speed) || 0 }))
          .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
        setPts(clean)
        setIdx(clean.length ? clean.length - 1 : 0)
      })
    return () => {
      alive = false
    }
  }, [row.id])

  useEffect(() => {
    if (!playing || !pts?.length) return
    if (idx >= pts.length - 1) {
      setPlaying(false)
      return
    }
    const t = setTimeout(() => setIdx((i) => Math.min(i + 1, pts.length - 1)), 220)
    return () => clearTimeout(t)
  }, [playing, idx, pts])

  if (pts == null) return <div className="field-hint">Loading recorded trip…</div>
  if (!pts.length) {
    return (
      <div className="field-hint">
        No recorded GPS yet — the AI Tracker logs a point every ~10s while the ride is active.
      </div>
    )
  }

  const actualPath = pts.map((p) => [p.lat, p.lng])
  let actualKm = 0
  for (let i = 1; i < pts.length; i++) {
    actualKm += distanceMeters(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng) / 1000
  }
  const started = new Date(pts[0].at)
  const ended = new Date(pts[pts.length - 1].at)
  const mins = Math.round((ended - started) / 60000)
  const cur = pts[Math.min(idx, pts.length - 1)]
  const plannedKm = row.distance_km != null ? Number(row.distance_km) : null

  return (
    <div className="live-track">
      <div className="live-track-badges">
        <span className="badge badge-accent">Actual {actualKm.toFixed(1)} km</span>
        {plannedKm != null && <span className="badge">Planned {plannedKm.toFixed(1)} km</span>}
        <span className="badge">{mins} min on the road</span>
        <span className="badge">{pts.length} points</span>
      </div>
      <RouteMap
        points={row.waypoints || []}
        line={row.route_geometry}
        totalKm={plannedKm ?? undefined}
        actualPath={actualPath}
        playMarker={cur}
        height={mapHeight}
      />
      <div className="trip-play">
        <button type="button" className="btn btn-ghost btn-square btn-sm" onClick={() => setPlaying((p) => !p)}>
          {playing ? 'Pause' : idx >= pts.length - 1 ? 'Replay' : 'Play'}
        </button>
        <input
          type="range"
          min={0}
          max={pts.length - 1}
          value={idx}
          onChange={(e) => {
            setPlaying(false)
            setIdx(Number(e.target.value))
          }}
        />
        <span className="field-hint">
          {fmtTimeOnly12(new Date(cur.at).toISOString())} · {Math.round(cur.speed)} kph
        </span>
      </div>
      <span className="field-hint">
        {fmtDate(row.ride_date)} · {fmtTimeOnly12(started.toISOString())} → {fmtTimeOnly12(ended.toISOString())}
      </span>
    </div>
  )
}

// ── Ride form ─────────────────────────────────────────────────────────────
function RideModal({
  row,
  startInEdit = false,
  canEdit = true,
  flights,
  crew,
  vehicles,
  drivers = [],
  allowedCities,
  defaultCityId,
  createdBy,
  initial, // pure Add-mode prefill (e.g. from a Ride Plan row) - see buildPlanInitial()
  onClose,
  onDone,
}) {
  const isAdd = !row
  const [editing, setEditing] = useState(isAdd || startInEdit)

  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [routeData, setRouteData] = useState(null) // { distanceKm, durationMin, line }
  const [dhRoute, setDhRoute] = useState(null) // "Also create a Deadhead" preview: { distanceKm, durationMin, line }
  const [rlRoute, setRlRoute] = useState(null) // "Also create a Return Leg" preview: { distanceKm, durationMin, line }
  const [playback, setPlayback] = useState(false) // Ride View: show the recorded trip instead of the route/live map
  const [notifyBusy, setNotifyBusy] = useState(false)
  const [conflict, setConflict] = useState(null) // { ref_no, end_at }
  const [startTouched, setStartTouched] = useState(Boolean(initial?.start_time))
  const [shift, setShift] = useState(row?.shift || initial?.shift || 'day') // manual Day/Night pick - no time-window auto-detection
  // Duty Sheet: for a Night ride, the dispatcher can count it against the
  // PREVIOUS day's duty sheet (the shift started the day before, even though
  // the ride itself is dispatched and happens on ride_date) - restore that
  // checkbox's state from the saved duty_sheet_date when editing.
  const [dutySheetPrevDay, setDutySheetPrevDay] = useState(
    () => Boolean(row?.duty_sheet_date && row?.ride_date && row.duty_sheet_date === addDays(row.ride_date, -1)),
  )
  // Pickup only, add-only: also create a Deadhead ride (Airport -> the first
  // crew stop) so the vehicle is positioned before the pickup run. Chains off
  // the pickup -> displays as "<pickup ref>-PD", cascades on delete.
  const [alsoDeadhead, setAlsoDeadhead] = useState(Boolean(initial?.alsoDeadhead))
  // Dropoff only, add-only: also create a Return Leg ride (last crew stop ->
  // Airport) once this dropoff ends, mirroring "Also create a Deadhead"
  // above - same pattern, opposite direction. Chains off the dropoff ->
  // displays as "<dropoff ref>-R", cascades on delete.
  const [alsoReturnLeg, setAlsoReturnLeg] = useState(Boolean(initial?.alsoReturnLeg))

  const initialCrew = row
    ? [...(row?.ride_crew || [])]
        .sort((a, b) => a.seq - b.seq)
        .map((x) => x.crew)
        .filter(Boolean)
    : (initial?.crewList ?? [])

  const [form, setForm] = useState({
    flight_id: row?.flight_id ?? initial?.flight_id ?? '',
    flight_no: row?.flight_no ?? initial?.flight_no ?? '',
    flight_code: row?.flight_code ?? initial?.flight_code ?? '',
    block_type: row?.block_type ?? initial?.block_type ?? '',
    deadhead_mode: row?.deadhead_mode ?? 'airport',
    city_id: row?.city_id ?? initial?.city_id ?? defaultCityId ?? allowedCities[0]?.id ?? '',
    ride_date: row?.ride_date ?? initial?.ride_date ?? pkToday(),
    checkin_old: toTime24(row?.checkin_old ?? initial?.checkin_old),
    checkin_new: toTime24(row?.checkin_new ?? initial?.checkin_new),
    checkout_old: toTime24(row?.checkout_old ?? initial?.checkout_old),
    checkout_new: toTime24(row?.checkout_new ?? initial?.checkout_new),
    start_time: row?.start_at ? isoToLocalTime(row.start_at) : (initial?.start_time ?? ''),
    vehicle_id: row?.vehicle_id ?? initial?.vehicle_id ?? '',
    is_adhoc_vehicle: row?.is_adhoc_vehicle ?? initial?.is_adhoc_vehicle ?? false,
    adhoc_vehicle_no: row?.adhoc_vehicle_no ?? initial?.adhoc_vehicle_no ?? '',
    notes: row?.notes ?? initial?.notes ?? '',
  })
  const [crewList, setCrewList] = useState(initialCrew)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  // A rented, not-in-fleet vehicle: vehicle_id/driver_id stay null. No
  // details to type in - `adhoc_vehicle_no` is assigned automatically below
  // ("Ad-Hoc 01", "Ad-Hoc 02", ... reset every calendar day per city) purely
  // so a dispatcher can see how many ad-hoc cars a day needed, at a glance.
  // See the "Ad-hoc vehicle" checkbox below and the
  // 20260912120000_ride_adhoc_vehicle.sql migration.
  const setAdhoc = (checked) =>
    setForm((f) => ({
      ...f,
      is_adhoc_vehicle: checked,
      vehicle_id: checked ? '' : f.vehicle_id,
      adhoc_vehicle_no: '', // force a fresh number next time this is checked
    }))

  const selVehicle = form.is_adhoc_vehicle ? null : vehicles.find((v) => v.id === form.vehicle_id)
  const driverId = selVehicle
    ? shift === 'night'
      ? selVehicle.night_driver_id
      : selVehicle.driver_id
    : null
  const driverName = driverId ? drivers.find((d) => d.id === driverId)?.name || '—' : ''
  const hasVehicle = form.is_adhoc_vehicle || Boolean(form.vehicle_id)
  // The vehicle_id/shift/driver_id (+ ad-hoc vehicle no) shared by the main
  // ride and its "also create a Deadhead/Return Leg" companions - same
  // vehicle info goes on all of them (no separate driver name/phone to carry -
  // an ad-hoc car's driver isn't tracked, only that a vehicle was ad-hoc).
  const vehicleFields = () => ({
    vehicle_id: form.is_adhoc_vehicle ? null : form.vehicle_id || null,
    shift: hasVehicle ? shift : null,
    driver_id: driverId || null,
    is_adhoc_vehicle: form.is_adhoc_vehicle,
    adhoc_vehicle_no: form.is_adhoc_vehicle ? form.adhoc_vehicle_no || null : null,
    adhoc_driver_name: null,
    adhoc_driver_phone: null,
  })
  const dutySheetDate =
    shift === 'night' && dutySheetPrevDay ? addDays(form.ride_date, -1) : form.ride_date

  const cityId = Number(form.city_id) || null

  // Assign the next "Ad-Hoc NN" for this city+date once, as soon as the box
  // is checked and a number isn't already set (a saved edit already has one -
  // never renumber it just because the form re-rendered).
  useEffect(() => {
    if (!form.is_adhoc_vehicle || form.adhoc_vehicle_no || !cityId || !form.ride_date) return
    let alive = true
    supabase
      .from('rides')
      .select('adhoc_vehicle_no')
      .eq('city_id', cityId)
      .eq('ride_date', form.ride_date)
      .eq('is_adhoc_vehicle', true)
      .then(({ data }) => {
        if (!alive) return
        const nums = (data ?? [])
          .map((r) => Number(String(r.adhoc_vehicle_no ?? '').match(/(\d+)\s*$/)?.[1]))
          .filter(Number.isFinite)
        const next = (nums.length ? Math.max(...nums) : 0) + 1
        set('adhoc_vehicle_no', `Ad-Hoc ${String(next).padStart(2, '0')}`)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.is_adhoc_vehicle, form.adhoc_vehicle_no, cityId, form.ride_date])

  const airport = useMemo(() => {
    const c = allowedCities.find((x) => x.id === cityId)
    return { name: c?.airport_name || '', lat: Number(c?.airport_lat), lng: Number(c?.airport_lng) }
  }, [allowedCities, cityId])
  // this city's own Check-in / Check-out buffer (minutes); falls back to the
  // defaults until the city record (or its buffer columns) is available
  const cityBuffers = useMemo(() => {
    const c = allowedCities.find((x) => x.id === cityId)
    const ci = Number(c?.checkin_buffer_min)
    const co = Number(c?.checkout_buffer_min)
    return {
      checkin: Number.isFinite(ci) ? ci : DEFAULT_CHECKIN_BUFFER_MIN,
      checkout: Number.isFinite(co) ? co : DEFAULT_CHECKOUT_BUFFER_MIN,
    }
  }, [allowedCities, cityId])
  const deadheadBufferMin = useMemo(() => {
    const d = Number(allowedCities.find((x) => x.id === cityId)?.deadhead_buffer_min)
    return Number.isFinite(d) ? d : DEFAULT_DEADHEAD_BUFFER_MIN
  }, [allowedCities, cityId])
  const returnLegBufferMin = useMemo(() => {
    const r = Number(allowedCities.find((x) => x.id === cityId)?.return_leg_buffer_min)
    return Number.isFinite(r) ? r : DEFAULT_RETURN_LEG_BUFFER_MIN
  }, [allowedCities, cityId])
  const crewWaitBufferMin = useMemo(() => {
    const w = Number(allowedCities.find((x) => x.id === cityId)?.crew_wait_buffer_min)
    return Number.isFinite(w) ? w : DEFAULT_CREW_WAIT_BUFFER_MIN
  }, [allowedCities, cityId])

  const rule = crewRule(form.block_type, form.deadhead_mode)
  const routePoints = useMemo(
    () => buildRoutePoints(form.block_type, form.deadhead_mode, crewList.map((c) => ({ ...c, crew_id: c.id })), airport),
    [form.block_type, form.deadhead_mode, crewList, airport],
  )
  const routeReady = routeComplete(routePoints)
  // signature of an ordered point list (~1 m) - used to skip an ORS call when
  // the route still matches what was saved (see the route effect below)
  const routeSig = (pts) =>
    (pts || [])
      .map((p) => `${Number(p.lat).toFixed(5)},${Number(p.lng).toFixed(5)}`)
      .join('|')
  const savedRouteSig = useMemo(() => (row?.waypoints ? routeSig(row.waypoints) : null), [row])

  // pick a flight -> snapshot + auto block + city + times
  const pickFlight = (fid) => {
    const f = flights.find((x) => x.id === fid)
    if (!f) return set('flight_id', '')
    setForm((prev) => {
      const block = f.block_type || prev.block_type || 'pickup'
      const slot = primaryTimeSlot(block)
      const ft = toTime24(f.flight_time)
      return {
        ...prev,
        flight_id: fid,
        flight_no: f.flight_no,
        flight_code: f.flight_code || '',
        block_type: block,
        city_id: f.city_id,
        checkin_old: slot === 'checkin' ? ft : prev.checkin_old,
        checkin_new: slot === 'checkin' && !prev.checkin_new ? ft : prev.checkin_new,
        checkout_old: slot === 'checkout' ? ft : prev.checkout_old,
        checkout_new: slot === 'checkout' && !prev.checkout_new ? ft : prev.checkout_new,
      }
    })
    setCrewList([])
  }

  // block change -> re-map the flight time to the right slot, trim crew to max
  const pickBlock = (block) => {
    setForm((prev) => {
      const f = flights.find((x) => x.id === prev.flight_id)
      const ft = toTime24(f?.flight_time)
      const slot = primaryTimeSlot(block)
      return {
        ...prev,
        block_type: block,
        checkin_old: slot === 'checkin' ? ft || prev.checkin_old : prev.checkin_old,
        checkin_new: slot === 'checkin' && !prev.checkin_new ? ft : prev.checkin_new,
        checkout_old: slot === 'checkout' ? ft || prev.checkout_old : prev.checkout_old,
        checkout_new: slot === 'checkout' && !prev.checkout_new ? ft : prev.checkout_new,
      }
    })
    const r = crewRule(block, form.deadhead_mode)
    if (r.max != null) setCrewList((cl) => cl.slice(0, r.max))
  }

  // fetch the ORS route ONLY when it can change something and actually changed:
  //  - view mode never calls ORS (the row already carries distance_km /
  //    duration_min / route_geometry, all read below as fallbacks)
  //  - on edit, if the ordered points still match the saved waypoints, keep the
  //    stored figures and skip the call
  // `routeInfo()` itself also caches by coords, so a genuine repeat is free.
  useEffect(() => {
    if (!editing || !routeReady) {
      setRouteData(null)
      return
    }
    if (savedRouteSig && routeSig(routePoints) === savedRouteSig) {
      setRouteData(null)
      return
    }
    let alive = true
    const id = setTimeout(async () => {
      const info = await routeInfo(routePoints.map((p) => [p.lng, p.lat]))
      if (alive) setRouteData(info)
    }, 400)
    return () => {
      alive = false
      clearTimeout(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, routeReady, routePoints, savedRouteSig])

  // "Also create a Deadhead" (Pickup, add-mode): preview the Airport -> first
  // crew leg so the form can show that deadhead's own Ride Time up front.
  const dhFirstCrew = crewList[0]
  useEffect(() => {
    if (!(isAdd && alsoDeadhead && form.block_type === 'pickup' && dhFirstCrew)) {
      setDhRoute(null)
      return
    }
    const pts = buildRoutePoints('deadhead', 'airport', [{ ...dhFirstCrew, crew_id: dhFirstCrew.id }], airport)
    if (!routeComplete(pts)) {
      setDhRoute(null)
      return
    }
    let alive = true
    const id = setTimeout(async () => {
      const info = await routeInfo(pts.map((p) => [p.lng, p.lat]))
      if (alive) setDhRoute(info)
    }, 400)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [isAdd, alsoDeadhead, form.block_type, dhFirstCrew, airport])

  // "Also create a Return Leg" (Dropoff, add-mode): preview the last crew ->
  // Airport leg so the form can show that return leg's own Ride Time up front.
  const rlLastCrew = crewList[crewList.length - 1]
  useEffect(() => {
    if (!(isAdd && alsoReturnLeg && form.block_type === 'dropoff' && rlLastCrew)) {
      setRlRoute(null)
      return
    }
    const pts = buildRoutePoints('return_leg', null, [{ ...rlLastCrew, crew_id: rlLastCrew.id }], airport)
    if (!routeComplete(pts)) {
      setRlRoute(null)
      return
    }
    let alive = true
    const id = setTimeout(async () => {
      const info = await routeInfo(pts.map((p) => [p.lng, p.lat]))
      if (alive) setRlRoute(info)
    }, 400)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [isAdd, alsoReturnLeg, form.block_type, rlLastCrew, airport])

  // A multi-crew pickup / dropoff waits at every crew stop for them to board /
  // alight - crewCount * the city's crew-wait buffer (once there's >1 crew). It
  // folds into duration_min so ETA, end_at, the Pickup-Time auto-suggest and
  // every downstream display (table, view, export, Vehicle Board) account for it.
  const crewWaitMin = crewWaitMinutes(form.block_type, crewList.length, crewWaitBufferMin)
  const roadMin = routeData?.durationMin ?? null
  const durMin = roadMin != null ? roadMin + crewWaitMin : (row?.duration_min ?? null)

  // auto-suggest "Pickup Time" / "Drop Time" from the block + its flight time + trip duration,
  // using THIS ride's city's own Check-in/Check-out buffer (cities.checkin/checkout_buffer_min).
  // Anchor = the Actual time if set, else the scheduled one (checkin_new || checkin_old).
  // Pickup:  crew must be AT the airport [checkin buffer] before check-in -> start = check-in - buffer - drive.
  // Dropoff: the ride begins [checkout buffer] after the crew checks out  -> start = check-out + buffer.
  useEffect(() => {
    if (startTouched) return
    const anchor =
      form.block_type === 'pickup'
        ? form.checkin_new || form.checkin_old
        : form.block_type === 'dropoff'
          ? form.checkout_new || form.checkout_old
          : ''
    if (!anchor) return
    const [h, m] = anchor.split(':').map(Number)
    const mins = h * 60 + m
    const fmt = (x) => {
      const v = ((x % 1440) + 1440) % 1440
      return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`
    }
    set(
      'start_time',
      form.block_type === 'pickup'
        ? fmt(mins - cityBuffers.checkin - (durMin ?? 0))
        : fmt(mins + cityBuffers.checkout),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    durMin,
    form.block_type,
    form.checkin_new,
    form.checkin_old,
    form.checkout_new,
    form.checkout_old,
    cityBuffers.checkin,
    cityBuffers.checkout,
  ])

  const startAt = toPkIso(form.ride_date, form.start_time)
  // ETA (arrival) = start + trip minutes (road + crew waits) ; vehicle-busy end = + buffer.
  const etaAt = startAt && durMin != null ? new Date(new Date(startAt).getTime() + durMin * 60000).toISOString() : null
  const endAt = startAt
    ? new Date(new Date(startAt).getTime() + ((durMin ?? 0) + BUFFER_MIN) * 60000).toISOString()
    : null

  // "Also create a Deadhead": it must ARRIVE at the first crew stop
  // `deadhead_buffer_min` before the pickup starts, so its own Ride Time =
  // Pickup Time − Airport→crew drive − that buffer. Shown in the form and
  // reused at submit.
  const dhDriveMin = dhRoute?.durationMin ?? null
  const dhStartAt =
    alsoDeadhead && startAt && dhDriveMin != null
      ? new Date(new Date(startAt).getTime() - (dhDriveMin + deadheadBufferMin) * 60000).toISOString()
      : null
  const dhArriveAt =
    dhStartAt ? new Date(new Date(startAt).getTime() - deadheadBufferMin * 60000).toISOString() : null

  // "Also create a Return Leg": it LEAVES the last crew's stop
  // `return_leg_buffer_min` after this dropoff's own arrival there, so its
  // own Ride Time = Drop-off ETA + that buffer. Arrival at the airport =
  // Ride Time + the Airport drive. Shown in the form and reused at submit.
  const rlDriveMin = rlRoute?.durationMin ?? null
  const rlStartAt =
    alsoReturnLeg && etaAt
      ? new Date(new Date(etaAt).getTime() + returnLegBufferMin * 60000).toISOString()
      : null
  const rlArriveAt =
    rlStartAt && rlDriveMin != null
      ? new Date(new Date(rlStartAt).getTime() + rlDriveMin * 60000).toISOString()
      : null

  // vehicle conflict pre-check — TEMPORARILY DISABLED (commented out) per
  // request, to be reworked/re-applied properly later. Leaving `conflict`
  // permanently null disables the submit-block and the "Busy on Ride ..."
  // hint below without touching either of those call sites.
  useEffect(() => {
    setConflict(null)
    // if (!form.vehicle_id || !startAt || !endAt) {
    //   setConflict(null)
    //   return
    // }
    // let alive = true
    // const NIL = '00000000-0000-0000-0000-000000000000'
    // supabase
    //   .from('rides')
    //   .select('ref_no, start_at, end_at')
    //   .eq('vehicle_id', form.vehicle_id)
    //   .lt('start_at', endAt)
    //   .gt('end_at', startAt)
    //   .neq('id', row?.id ?? NIL)
    //   .then(({ data }) => {
    //     if (alive) setConflict(data?.[0] || null)
    //   })
    // return () => {
    //   alive = false
    // }
  }, [form.vehicle_id, startAt, endAt, row?.id])

  const cityCrew = crew.filter((c) => c.city_id === cityId && !crewList.some((x) => x.id === c.id))
  const cityVehicles = vehicles.filter((v) => v.city_id === cityId)

  // A crew member already dispatched on ANOTHER ride for this exact flight
  // occurrence (same flight_id + ride_date) and the SAME block type can't be
  // added again - e.g. picked up twice on two different Pickup rides for the
  // same flight. Scoped to block_type specifically so it never fires on the
  // Deadhead/Return-Leg companion flows, which legitimately reuse the same
  // crew + flight_id on a DIFFERENT block_type by design.
  const addCrew = async (id) => {
    const c = crew.find((x) => x.id === id)
    if (!c) return
    if (rule.max != null && crewList.length >= rule.max) return
    if (form.flight_id) {
      let dq = supabase
        .from('rides')
        .select('id, ref_no')
        .eq('flight_id', form.flight_id)
        .eq('block_type', form.block_type)
        .eq('ride_date', form.ride_date)
      if (row?.id) dq = dq.neq('id', row.id)
      const { data: candidates } = await dq
      if (candidates?.length) {
        const { data: hit } = await supabase
          .from('ride_crew')
          .select('ride_id')
          .eq('crew_id', id)
          .in('ride_id', candidates.map((r) => r.id))
          .maybeSingle()
        if (hit) {
          const dupeRef = candidates.find((r) => r.id === hit.ride_id)?.ref_no
          toast.error(`${c.name} is already dispatched on this flight - Ride ${dupeRef}`)
          return
        }
      }
    }
    setCrewList((cl) => [...cl, c])
  }
  const removeCrew = (id) => setCrewList((cl) => cl.filter((c) => c.id !== id))

  const [optimizing, setOptimizing] = useState(false)
  const optimize = async () => {
    setOptimizing(true)
    const order = await optimizeCrewOrder(
      form.block_type,
      crewList.map((c) => ({ id: c.id, lat: Number(c.stop_lat), lng: Number(c.stop_lng) })),
      airport,
    )
    setOptimizing(false)
    if (!order) {
      toast.error('Could not optimise — keeping the current order')
      return
    }
    setCrewList((cl) => order.map((id) => cl.find((c) => c.id === id)).filter(Boolean))
    setStartTouched(false) // let the window re-suggest off the new duration
    toast.success('Stop order optimised')
  }

  const origin = routePoints[0]
  const dest = routePoints[routePoints.length - 1]
  // Pickup / Drop Off get a flat extra distance (Settings -> Ride Buffer Time),
  // folded into distance_km; extra_km keeps the amount for the View breakdown.
  const extraKm = blockExtraKm(form.block_type, allowedCities.find((c) => c.id === cityId))
  const roadKm = routeData?.distanceKm ?? null
  const km = roadKm != null ? roadKm + extraKm : (row?.distance_km ?? null)

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (!form.flight_id && form.block_type !== 'deadhead' && form.block_type !== 'return_leg')
      return setErr('Pick a flight')
    if (!form.block_type) return setErr('Pick a block type')
    if (!cityId) return setErr('Pick a city')
    if (crewList.length < rule.min) return setErr(`This block needs at least ${rule.min} crew`)
    if (rule.max != null && crewList.length > rule.max)
      return setErr(`This block takes exactly ${rule.max} crew`)
    if (!routeReady) return setErr('Route is incomplete — check the crew stops and airport have coordinates')
    if (form.is_adhoc_vehicle && !form.adhoc_vehicle_no)
      return setErr('Still assigning an ad-hoc number — try again in a moment')
    if (hasVehicle && !startAt) return setErr('Set the ride start time for the vehicle')
    if (isAdd && alsoDeadhead && form.block_type === 'pickup' && !startAt)
      return setErr('Set the Pickup Time — the deadhead is timed to arrive just before it')
    if (isAdd && alsoReturnLeg && form.block_type === 'dropoff' && !etaAt)
      return setErr('Set the Drop Time — the return leg is timed off its arrival')
    if (form.vehicle_id && conflict)
      return setErr(`Vehicle busy on Ride ${conflict.ref_no} till ${fmtTimeOnly12(conflict.end_at)}`)

    setBusy(true)
    const payload = {
      city_id: cityId,
      flight_id: form.flight_id || null,
      flight_no: form.flight_no || null,
      flight_code: form.flight_code || null,
      block_type: form.block_type,
      deadhead_mode: form.block_type === 'deadhead' ? form.deadhead_mode : null,
      ride_date: form.ride_date,
      duty_sheet_date: dutySheetDate,
      checkin_old: form.checkin_old || null,
      checkin_new: form.checkin_new || form.checkin_old || null,
      checkout_old: form.checkout_old || null,
      checkout_new: form.checkout_new || form.checkout_old || null,
      start_at: startAt,
      end_at: endAt,
      ...vehicleFields(),
      airport_name: airport.name || null,
      airport_lat: Number.isFinite(airport.lat) ? airport.lat : null,
      airport_lng: Number.isFinite(airport.lng) ? airport.lng : null,
      origin_label: origin?.label || null,
      origin_lat: origin?.lat ?? null,
      origin_lng: origin?.lng ?? null,
      dest_label: dest?.label || null,
      dest_lat: dest?.lat ?? null,
      dest_lng: dest?.lng ?? null,
      waypoints: routePoints,
      route_geometry: routeData?.line ?? row?.route_geometry ?? null,
      distance_km: km,
      extra_km: roadKm != null ? extraKm : (row?.extra_km ?? 0),
      duration_min: durMin,
      status: row?.status ?? 'dispatched',
      notes: form.notes.trim() || null,
    }
    let rideId = row?.id
    let rideRefNo = row?.ref_no
    if (isAdd) {
      const res = await supabase
        .from('rides')
        .insert({ ...payload, created_by: createdBy ?? null })
        .select('id, ref_no')
        .single()
      if (res.error) {
        setBusy(false)
        return setErr(mapRideError(res.error, form.vehicle_id, cityVehicles))
      }
      rideId = res.data.id
      rideRefNo = res.data.ref_no
    } else {
      const res = await supabase.from('rides').update(payload).eq('id', row.id)
      if (res.error) {
        setBusy(false)
        return setErr(mapRideError(res.error, form.vehicle_id, cityVehicles))
      }
    }
    // replace crew links
    await supabase.from('ride_crew').delete().eq('ride_id', rideId)
    if (crewList.length) {
      const ins = await supabase
        .from('ride_crew')
        .insert(crewList.map((c, i) => ({ ride_id: rideId, crew_id: c.id, seq: i })))
      if (ins.error) {
        setBusy(false)
        return setErr(ins.error.message)
      }
    }

    // Pickup + "Also create a Deadhead": one extra ride, Airport -> the first
    // crew stop, on the same vehicle, timed to arrive `deadhead_buffer_min`
    // before the pickup starts. Chains off the pickup (return_of_ride_id) so
    // it shows as "<pickup ref>-PD" and cascades if the pickup is deleted.
    let dhNote = ''
    let dhRideId = null
    if (isAdd && alsoDeadhead && form.block_type === 'pickup' && crewList[0] && startAt) {
      try {
        const c1 = crewList[0]
        const dhPts = buildRoutePoints('deadhead', 'airport', [{ ...c1, crew_id: c1.id }], airport)
        // reuse the form's preview route; only re-fetch if it isn't ready yet
        const dhInfo =
          dhRoute ?? (routeComplete(dhPts) ? await routeInfo(dhPts.map((p) => [p.lng, p.lat])) : null)
        const dhDrive = dhInfo?.durationMin ?? 0
        const pickupStartMs = new Date(startAt).getTime()
        const dhStart =
          dhStartAt ?? new Date(pickupStartMs - (dhDrive + deadheadBufferMin) * 60000).toISOString()
        const dhIns = await supabase
          .from('rides')
          .insert({
            city_id: cityId,
            flight_id: form.flight_id,
            flight_no: form.flight_no,
            flight_code: form.flight_code || null,
            block_type: 'deadhead',
            deadhead_mode: 'airport',
            ride_date: form.ride_date,
            duty_sheet_date: dutySheetDate,
            ...vehicleFields(),
            airport_name: airport.name || null,
            airport_lat: Number.isFinite(airport.lat) ? airport.lat : null,
            airport_lng: Number.isFinite(airport.lng) ? airport.lng : null,
            origin_label: dhPts[0]?.label || null,
            origin_lat: dhPts[0]?.lat ?? null,
            origin_lng: dhPts[0]?.lng ?? null,
            dest_label: dhPts[1]?.label || null,
            dest_lat: dhPts[1]?.lat ?? null,
            dest_lng: dhPts[1]?.lng ?? null,
            waypoints: dhPts,
            route_geometry: dhInfo?.line ?? null,
            distance_km: dhInfo?.distanceKm ?? null,
            duration_min: dhInfo?.durationMin ?? null,
            start_at: dhStart,
            end_at: new Date(pickupStartMs).toISOString(),
            status: 'dispatched',
            return_of_ride_id: rideId,
            created_by: createdBy ?? null,
          })
          .select('id')
          .single()
        if (dhIns.error) throw new Error(dhIns.error.message)
        await supabase.from('ride_crew').insert({ ride_id: dhIns.data.id, crew_id: c1.id, seq: 0 })
        dhRideId = dhIns.data.id
        dhNote = `, deadhead ${rideRefNo}-PD`
      } catch (e2) {
        toast.error(`Ride created, but the deadhead failed: ${e2.message}`)
      }
    }

    // Dropoff + "Also create a Return Leg": one extra ride, the last crew
    // stop -> Airport, on the same vehicle, leaving `return_leg_buffer_min`
    // after this dropoff's own arrival there. Chains off the dropoff
    // (return_of_ride_id) so it shows as "<dropoff ref>-R" and cascades if
    // the dropoff is deleted - same shape CreateRideModal's Return Leg tab
    // already produces, just created inline instead of as a second step.
    let rlNote = ''
    let rlRideId = null
    if (isAdd && alsoReturnLeg && form.block_type === 'dropoff' && crewList.length && etaAt) {
      try {
        const lastC = crewList[crewList.length - 1]
        const rlPts = buildRoutePoints('return_leg', null, [{ ...lastC, crew_id: lastC.id }], airport)
        // reuse the form's preview route; only re-fetch if it isn't ready yet
        const rlInfo =
          rlRoute ?? (routeComplete(rlPts) ? await routeInfo(rlPts.map((p) => [p.lng, p.lat])) : null)
        const rlDrive = rlInfo?.durationMin ?? 0
        const rlStart =
          rlStartAt ?? new Date(new Date(etaAt).getTime() + returnLegBufferMin * 60000).toISOString()
        const rlEnd = new Date(new Date(rlStart).getTime() + (rlDrive + BUFFER_MIN) * 60000).toISOString()
        const rlIns = await supabase
          .from('rides')
          .insert({
            city_id: cityId,
            flight_id: form.flight_id,
            flight_no: form.flight_no,
            flight_code: form.flight_code || null,
            block_type: 'return_leg',
            ride_date: form.ride_date,
            duty_sheet_date: dutySheetDate,
            ...vehicleFields(),
            airport_name: airport.name || null,
            airport_lat: Number.isFinite(airport.lat) ? airport.lat : null,
            airport_lng: Number.isFinite(airport.lng) ? airport.lng : null,
            origin_label: rlPts[0]?.label || null,
            origin_lat: rlPts[0]?.lat ?? null,
            origin_lng: rlPts[0]?.lng ?? null,
            dest_label: rlPts[1]?.label || null,
            dest_lat: rlPts[1]?.lat ?? null,
            dest_lng: rlPts[1]?.lng ?? null,
            waypoints: rlPts,
            route_geometry: rlInfo?.line ?? null,
            distance_km: rlInfo?.distanceKm ?? null,
            duration_min: rlInfo?.durationMin ?? null,
            start_at: rlStart,
            end_at: rlEnd,
            status: 'dispatched',
            return_of_ride_id: rideId,
            created_by: createdBy ?? null,
          })
          .select('id')
          .single()
        if (rlIns.error) throw new Error(rlIns.error.message)
        await supabase.from('ride_crew').insert({ ride_id: rlIns.data.id, crew_id: lastC.id, seq: 0 })
        rlRideId = rlIns.data.id
        rlNote = `, return leg ${rideRefNo}-R`
      } catch (e3) {
        toast.error(`Ride created, but the return leg failed: ${e3.message}`)
      }
    }

    setBusy(false)
    toast.success(isAdd ? `Ride created${dhNote}${rlNote}` : 'Ride updated')
    onDone({ rideId, rideRefNo, deadheadRideId: dhRideId, returnLegRideId: rlRideId })
  }

  const rowRef = row?.display_ref ?? row?.ref_no
  const title = isAdd
    ? 'Add Ride'
    : editing
      ? `Edit ride ${rowRef}`
      : `Ride ${rowRef} · ${blockLabel(row.block_type)}`

  // ---- read-only view ----
  if (!editing) {
    const gm = gmapsRoute(row.waypoints)
    const hasLive = Boolean(row.vehicle?.tracker_url)
    const crewNames = [...(row.ride_crew || [])]
      .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
      .map((x) => x.crew?.name)
      .filter(Boolean)
    const distanceText =
      row.distance_km == null
        ? '—'
        : Number(row.extra_km) > 0
          ? `${(Number(row.distance_km) - Number(row.extra_km)).toFixed(2)} + ${Number(row.extra_km)} extra = ${Number(row.distance_km).toFixed(2)} km`
          : `${Number(row.distance_km).toFixed(2)} km`
    return (
      <Modal
        open
        onClose={onClose}
        title={title}
        width="min(1600px, 97vw)"
        size="full"
        footer={
          <>
            <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
              Close
            </button>
            {NOTIFY_ENABLED && canEdit && row.vehicle_id && (
              <button
                type="button"
                className="btn btn-ghost btn-square"
                disabled={notifyBusy}
                onClick={async () => {
                  setNotifyBusy(true)
                  const res = await notifyRide(row.id)
                  setNotifyBusy(false)
                  if (res?.ok) toast.success(`Sent to ${res.recipients} recipient(s)`)
                  else toast.error(res?.error || 'Could not send')
                }}
              >
                <Send size={13} /> {notifyBusy ? 'Sending…' : 'Notify'}
              </button>
            )}
            {canEdit && (
              <button type="button" className="btn btn-square" onClick={() => setEditing(true)}>
                <Pencil size={13} /> Edit
              </button>
            )}
          </>
        }
      >
        <div className="ride-view ride-view--split">
          <div className="ride-view-info">
            <div className="rv-grid">
              <RvField label="Flight" value={`${row.flight_no || '—'}${row.flight_code ? ' · ' + row.flight_code : ''}`} />
              <RvField label="Block" value={blockLabel(row.block_type)} />
              <RvField label="Date" value={fmtDate(row.ride_date)} />
              <RvField label="Duty Sheet" value={fmtDate(row.duty_sheet_date || row.ride_date)} />
              <RvField label="Check-in" value={fmtTime12(row.checkin_old)} />
              <RvField label="Actual" value={fmtTime12(row.checkin_new)} />
              <RvField label="Check-out" value={fmtTime12(row.checkout_old)} />
              <RvField label="Actual" value={fmtTime12(row.checkout_new)} />
            </div>

            <div className="rv-crew">
              <span className="view-label">
                Crew <span className="badge badge-accent">{displayCrewCount(row.ride_crew, row.block_type)}</span>
              </span>
              <div className="rv-crew-list">
                {crewNames.length ? (
                  crewNames.map((n, i) => <span key={i}>{n}</span>)
                ) : (
                  <span className="view-value">—</span>
                )}
              </div>
            </div>

            <div className="rv-grid">
              <RvField label="Vehicle" value={row.is_adhoc_vehicle ? `${row.adhoc_vehicle_no || '—'} · ad-hoc` : row.vehicle?.vehicle_no} />
              <RvField label="Driver" value={row.is_adhoc_vehicle ? null : row.driver?.name} />
              <RvField label={rideTimeLabel(row.block_type)} value={row.start_at ? fmtTimeOnly12(row.start_at) : '—'} />
              <RvField label="ETA" value={fmtTimeOnly12(etaOf(row.start_at, row.duration_min)) || '—'} />
            </div>

            <div className="view-row">
              <span className="view-label">Origin</span>
              <span className="view-value">{row.origin_label || '—'}</span>
            </div>
            <div className="view-row">
              <span className="view-label">Destination</span>
              <span className="view-value">{row.dest_label || '—'}</span>
            </div>
            <div className="view-row">
              <span className="view-label">Distance</span>
              <span className="view-value">{distanceText}</span>
            </div>
            <div className="view-row">
              <span className="view-label">Shift</span>
              <span className="view-value">{shiftLabel(row.shift)}</span>
            </div>
            <div className="view-row">
              <span className="view-label">Status</span>
              <span className="view-value">{statusLabel(row.status)}</span>
            </div>
            {row.status === 'cancelled' && (
              <>
                <div className="view-row">
                  <span className="view-label">Cancel reason</span>
                  <span className="view-value">{row.cancel_reason || '—'}</span>
                </div>
                <div className="view-row">
                  <span className="view-label">KM in reports</span>
                  <span className="view-value">
                    {row.count_km ? 'Counted' : 'Not counted'}
                  </span>
                </div>
              </>
            )}
            <div className="view-row">
              <span className="view-label">Notes</span>
              <span className="view-value">{row.notes || '—'}</span>
            </div>

            {gm && (
              <a className="btn btn-ghost btn-square btn-sm" href={gm} target="_blank" rel="noreferrer">
                <Navigation size={13} /> Open route in Google Maps
              </a>
            )}
          </div>

          <div className="ride-view-map">
            {playback ? (
              <TripPlayback row={row} mapHeight="calc(100vh - 240px)" />
            ) : hasLive ? (
              <LiveTrackingCard row={row} mapHeight="calc(100vh - 250px)" />
            ) : (
              <RouteMap
                points={row.waypoints || []}
                line={row.route_geometry}
                totalKm={row.distance_km != null ? Number(row.distance_km) : undefined}
                height="calc(100vh - 240px)"
              />
            )}
            <div className="ride-view-mapswitch">
              <button
                type="button"
                className={playback ? '' : 'on'}
                onClick={() => setPlayback(false)}
              >
                {hasLive ? 'Live' : 'Route'}
              </button>
              <button type="button" className={playback ? 'on' : ''} onClick={() => setPlayback(true)}>
                Trip playback
              </button>
            </div>
          </div>
        </div>
      </Modal>
    )
  }

  // ---- add / edit form ----
  const flightOpts = flights
    .filter((f) => !cityId || f.city_id === cityId || f.id === form.flight_id)
    .map((f) => ({
      value: f.id,
      label: `${f.flight_no}${f.flight_code ? ' · ' + f.flight_code : ''}`,
      sub: f.route || undefined,
    }))
  const vehicleOpts = cityVehicles.map((v) => ({
    value: v.id,
    label: v.vehicle_no,
    sub: v.driver ? `driver: ${v.driver.name}` : 'no driver',
  }))

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      width="min(1600px, 97vw)"
      size="full"
      footer={
        <>
          <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="ride-form" className="btn btn-square" disabled={busy || Boolean(conflict)}>
            {busy ? 'Saving…' : isAdd ? 'Create ride' : 'Save'}
          </button>
        </>
      }
    >
      <form id="ride-form" className="ride-view ride-view--split" onSubmit={submit}>
        <div className="ride-view-info modal-form">
          {err && <div className="modal-error">{err}</div>}

          <div className="field">
            <label>Flight</label>
            <SearchSelect
              value={form.flight_id}
              onChange={pickFlight}
              options={flightOpts}
              placeholder="Search a flight…"
            />
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="r-code">Flight code</label>
              <input id="r-code" className="input" value={form.flight_code} disabled />
            </div>
            <div className="field">
              <label htmlFor="r-block">Block type</label>
              <select
                id="r-block"
                className="select"
                value={form.block_type}
                onChange={(e) => pickBlock(e.target.value)}
              >
                <option value="" disabled>
                  Select…
                </option>
                {BLOCK_TYPES.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {form.block_type === 'deadhead' && (
            <div className="field">
              <label>Deadhead route</label>
              <div className="radio-row">
                <label className="check-line">
                  <input
                    type="radio"
                    name="dhmode"
                    checked={form.deadhead_mode === 'airport'}
                    onChange={() => {
                      set('deadhead_mode', 'airport')
                      setCrewList((cl) => cl.slice(0, 1))
                    }}
                  />
                  Airport → crew
                </label>
                <label className="check-line">
                  <input
                    type="radio"
                    name="dhmode"
                    checked={form.deadhead_mode === 'crew'}
                    onChange={() => set('deadhead_mode', 'crew')}
                  />
                  Crew → crew (2 crew)
                </label>
              </div>
            </div>
          )}

          <div className="field-row">
            <div className="field">
              <label htmlFor="r-date">Ride date</label>
              <input
                id="r-date"
                type="date"
                className="input"
                value={form.ride_date}
                onChange={(e) => set('ride_date', e.target.value)}
              />
            </div>
            <div className="field">
              <label>Airport (from city)</label>
              <input
                className="input"
                value={airport.name || `${cityNameOf(allowedCities, cityId)} airport not set`}
                disabled
              />
            </div>
          </div>

          {form.block_type === 'pickup' && (
            <div className="field-row">
              <div className="field">
                <label htmlFor="r-cio">Check-in</label>
                <input id="r-cio" type="time" className="input" value={form.checkin_old} disabled />
                <span className="field-hint">From the flight</span>
              </div>
              <div className="field">
                <label htmlFor="r-cin">Actual</label>
                <input
                  id="r-cin"
                  type="time"
                  className="input"
                  value={form.checkin_new}
                  onChange={(e) => set('checkin_new', e.target.value)}
                />
              </div>
            </div>
          )}
          {form.block_type === 'dropoff' && (
            <div className="field-row">
              <div className="field">
                <label htmlFor="r-coo">Check-out</label>
                <input id="r-coo" type="time" className="input" value={form.checkout_old} disabled />
                <span className="field-hint">From the flight</span>
              </div>
              <div className="field">
                <label htmlFor="r-con">Actual</label>
                <input
                  id="r-con"
                  type="time"
                  className="input"
                  value={form.checkout_new}
                  onChange={(e) => set('checkout_new', e.target.value)}
                />
              </div>
            </div>
          )}

        {/* crew */}
        <div className="field">
          <label>
            Crew <span className="badge badge-accent">{crewList.length}</span>{' '}
            <span className="field-hint">
              (
              {rule.max === rule.min
                ? `exactly ${rule.min}`
                : rule.max == null
                  ? `at least ${rule.min}, in visiting order`
                  : `${rule.min}–${rule.max}`}
              )
            </span>
          </label>
          {crewList.length > 0 && (
            <ol className="ride-crew-list">
              {crewList.map((c, i) => (
                <li key={c.id}>
                  <span className="ride-crew-seq">{i + 1}</span>
                  <span className="ride-crew-name">
                    ({c.ref_no}) {c.name}
                    {c.stop_name ? ` · ${c.stop_name}` : ''}
                    {!(Number.isFinite(Number(c.stop_lat)) && Number.isFinite(Number(c.stop_lng))) && (
                      <span className="ride-crew-warn"> · no coordinates</span>
                    )}
                  </span>
                  <button type="button" className="ride-crew-x" onClick={() => removeCrew(c.id)}>
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ol>
          )}
          {(rule.max == null || crewList.length < rule.max) && (
            <SearchSelect
              value=""
              onChange={addCrew}
              options={cityCrew.map((c) => ({
                value: c.id,
                label: `(${c.ref_no}) ${c.name}`,
                sub: c.stop_name || undefined,
              }))}
              placeholder={cityId ? 'Add a crew member…' : 'Pick a flight first'}
              disabled={!cityId}
            />
          )}
          {(form.block_type === 'pickup' || form.block_type === 'dropoff') &&
            crewList.length >= 3 && (
              <button
                type="button"
                className="btn btn-ghost btn-square btn-sm"
                style={{ marginTop: 8 }}
                disabled={optimizing}
                onClick={optimize}
              >
                <Sparkles size={13} /> {optimizing ? 'Optimising…' : 'Optimise stop order'}
              </button>
            )}
          {isAdd && form.block_type === 'pickup' && crewList.length > 0 && (
            <>
              <label className="check-line" style={{ marginTop: 10 }}>
                <input
                  type="checkbox"
                  checked={alsoDeadhead}
                  onChange={(e) => setAlsoDeadhead(e.target.checked)}
                />
                Also create a Deadhead ride (Airport → {crewList[0].stop_name || crewList[0].name})
              </label>
              {alsoDeadhead && (
                <span className="field-hint">
                  {!startAt
                    ? 'Set the Pickup Time first.'
                    : dhDriveMin == null
                      ? 'Working out the drive…'
                      : `Leaves ${fmtTimeOnly12(dhStartAt)} → ${crewList[0].stop_name || crewList[0].name} ${fmtTimeOnly12(dhArriveAt)} (${deadheadBufferMin} min before pickup)`}
                </span>
              )}
            </>
          )}
          {isAdd && form.block_type === 'dropoff' && crewList.length > 0 && (
            <>
              <label className="check-line" style={{ marginTop: 10 }}>
                <input
                  type="checkbox"
                  checked={alsoReturnLeg}
                  onChange={(e) => setAlsoReturnLeg(e.target.checked)}
                />
                Also create a Return Leg ride (
                {crewList[crewList.length - 1].stop_name || crewList[crewList.length - 1].name} → Airport)
              </label>
              {alsoReturnLeg && (
                <span className="field-hint">
                  {!etaAt
                    ? 'Set the Drop Time first.'
                    : rlDriveMin == null
                      ? 'Working out the drive…'
                      : `Leaves ${crewList[crewList.length - 1].stop_name || crewList[crewList.length - 1].name} ${fmtTimeOnly12(rlStartAt)} → Airport ${fmtTimeOnly12(rlArriveAt)} (${returnLegBufferMin} min after drop-off)`}
                </span>
              )}
            </>
          )}
        </div>

        {/* vehicle + window */}
        <div className="field">
          <label className="check-line">
            <input
              type="checkbox"
              checked={form.is_adhoc_vehicle}
              onChange={(e) => setAdhoc(e.target.checked)}
            />
            Ad-hoc vehicle (rented, not in fleet)
          </label>
          <span className="field-hint">
            {form.is_adhoc_vehicle
              ? form.adhoc_vehicle_no
                ? `${form.adhoc_vehicle_no} - auto-numbered, nothing else to fill in`
                : 'Assigning a number…'
              : 'Fleet busy? Add an outside car - auto-numbered, no details needed'}
          </span>
        </div>

        {!form.is_adhoc_vehicle && (
          <div className="field">
            <label>Assign vehicle</label>
            <SearchSelect
              value={form.vehicle_id}
              onChange={(v) => set('vehicle_id', v)}
              options={[{ value: '', label: 'No vehicle yet' }, ...vehicleOpts]}
              placeholder={cityId ? 'Search a vehicle…' : 'Pick a flight first'}
              disabled={!cityId}
            />
            {conflict && (
              <span className="field-error">
                Busy on Ride {conflict.ref_no} till {fmtTimeOnly12(conflict.end_at)}
              </span>
            )}
          </div>
        )}

        {hasVehicle && (
          <div className="field">
            <label>Shift{form.is_adhoc_vehicle ? '' : ' & Driver'}</label>
            <div className="shift-picker">
              <div className="shift-toggle">
                {['day', 'night'].map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={shift === s ? 'on' : ''}
                    onClick={() => {
                      setShift(s)
                      if (s === 'day') setDutySheetPrevDay(false)
                    }}
                  >
                    {shiftLabel(s)}
                  </button>
                ))}
              </div>
              {shift === 'night' && (
                <label className="check-line">
                  <input
                    type="checkbox"
                    checked={dutySheetPrevDay}
                    onChange={(e) => setDutySheetPrevDay(e.target.checked)}
                  />
                  Duty Sheet: previous day
                </label>
              )}
              {!form.is_adhoc_vehicle && (
                <div className={`shift-driver${driverName ? '' : ' empty'}`}>
                  <span className="primary">{driverName || `No ${shiftLabel(shift).toLowerCase()} driver`}</span>
                </div>
              )}
            </div>
            <span className="field-hint">Duty Sheet: {fmtDate(dutySheetDate)}</span>
          </div>
        )}

        <div className="field-row">
          <div className="field">
            <label htmlFor="r-start">{rideTimeLabel(form.block_type)}</label>
            <input
              id="r-start"
              type="time"
              className="input"
              value={form.start_time}
              onChange={(e) => {
                setStartTouched(true)
                set('start_time', e.target.value)
              }}
            />
            <span className="field-hint">
              {form.block_type === 'pickup'
                ? `Auto: ${cityBuffers.checkin} min before check-in`
                : form.block_type === 'dropoff'
                  ? `Auto: check-out + ${cityBuffers.checkout} min`
                  : 'Set the departure time'}
            </span>
          </div>
          <div className="field">
            <label>ETA (arrival)</label>
            <input
              className="input"
              value={etaAt ? fmtTimeOnly12(etaAt) : durMin == null ? 'needs route + start' : '—'}
              disabled
            />
            <span className="field-hint">
              {durMin != null ? `+ ${durMin} min${crewWaitMin > 0 ? ` (incl. ${crewWaitMin} crew wait)` : ''}` : 'Start + trip time'}
            </span>
          </div>
        </div>

        <div className="field">
          <label htmlFor="r-notes">Notes</label>
          <input
            id="r-notes"
            className="input"
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            autoComplete="off"
          />
        </div>
        </div>

        <div className="ride-view-map">
          <div className="field">
            <label>
              Route{' '}
              {km != null && (
                <span className="ride-km-badge">
                  {Number(km).toFixed(2)} km{durMin != null ? ` · ${durMin} min` : ''}
                  {extraKm > 0 && roadKm != null
                    ? ` — ${Number(roadKm).toFixed(2)} route + ${extraKm} extra`
                    : ''}
                  {crewWaitMin > 0 ? ` · ${roadMin ?? '—'} min drive + ${crewWaitMin} min crew wait` : ''}
                </span>
              )}
            </label>
          </div>
          <RouteMap points={routePoints} line={routeData?.line} height="calc(100vh - 260px)" />
          {routePoints.length >= 2 && (
            <span className="field-hint">
              {origin?.label} → {routePoints.slice(1, -1).map((p) => p.label).join(' → ') || ''}
              {routePoints.length > 2 ? ' → ' : ''}
              {dest?.label}
            </span>
          )}
        </div>
      </form>
    </Modal>
  )
}

// ── Generate rides (recurring) ────────────────────────────────────────────
const WEEKDAYS = [
  { d: 1, label: 'Mon' },
  { d: 2, label: 'Tue' },
  { d: 3, label: 'Wed' },
  { d: 4, label: 'Thu' },
  { d: 5, label: 'Fri' },
  { d: 6, label: 'Sat' },
  { d: 0, label: 'Sun' },
]

function GenerateRidesModal({ flights, crew, allowedCities, createdBy, onClose, onDone }) {
  const iso = pkToday()
  const [flightId, setFlightId] = useState('')
  const [from, setFrom] = useState(iso)
  const [to, setTo] = useState(iso)
  const [days, setDays] = useState(() => WEEKDAYS.reduce((a, w) => ({ ...a, [w.d]: true }), {}))
  const [crewList, setCrewList] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const flight = flights.find((f) => f.id === flightId)
  const cityId = flight?.city_id ?? null
  const block = flight?.block_type || 'pickup'
  const cityObj = allowedCities.find((c) => c.id === cityId)
  const airport = {
    name: cityObj?.airport_name || '',
    lat: Number(cityObj?.airport_lat),
    lng: Number(cityObj?.airport_lng),
  }
  const cityBuffers = {
    checkin: Number.isFinite(Number(cityObj?.checkin_buffer_min))
      ? Number(cityObj.checkin_buffer_min)
      : DEFAULT_CHECKIN_BUFFER_MIN,
    checkout: Number.isFinite(Number(cityObj?.checkout_buffer_min))
      ? Number(cityObj.checkout_buffer_min)
      : DEFAULT_CHECKOUT_BUFFER_MIN,
  }
  const rule = crewRule(block, 'airport')
  const cityCrew = crew.filter((c) => c.city_id === cityId && !crewList.some((x) => x.id === c.id))

  const dates = useMemo(() => {
    const out = []
    if (!from || !to || from > to) return out
    const cur = new Date(`${from}T00:00:00`)
    const end = new Date(`${to}T00:00:00`)
    while (cur <= end && out.length < 120) {
      if (days[cur.getDay()]) out.push(cur.toISOString().slice(0, 10))
      cur.setDate(cur.getDate() + 1)
    }
    return out
  }, [from, to, days])

  const addCrew = (id) => {
    const c = crew.find((x) => x.id === id)
    if (!c || (rule.max != null && crewList.length >= rule.max)) return
    setCrewList((cl) => [...cl, c])
  }

  const generate = async () => {
    setErr('')
    if (!flight) return setErr('Pick a flight')
    if (!dates.length) return setErr('No dates match the range + weekdays')
    if (dates.length > 60) return setErr('Too many dates (max 60) — narrow the range')
    if (crewList.length && crewList.length < rule.min)
      return setErr(`This block needs at least ${rule.min} crew`)

    setBusy(true)
    const pts = buildRoutePoints(
      block,
      'airport',
      crewList.map((c) => ({ ...c, crew_id: c.id })),
      airport,
    )
    const info = crewList.length && routeComplete(pts) ? await routeInfo(pts.map((p) => [p.lng, p.lat])) : null
    const slot = primaryTimeSlot(block)
    const ft = toTime24(flight.flight_time)
    const origin = pts[0]
    const dest = pts[pts.length - 1]
    // multi-crew wait folds into the stored duration_min, same as the Ride form
    const crewWait = crewWaitMinutes(block, crewList.length, cityObj?.crew_wait_buffer_min)
    const tripMin = info ? info.durationMin + crewWait : null
    const durMs = (tripMin ?? 0) * 60000
    // Pickup / Drop Off extra KM, same as the Ride form
    const extraKm = blockExtraKm(block, cityObj)
    const totalKm = info ? info.distanceKm + extraKm : null

    const rows = dates.map((date) => {
      let start_at = null
      let end_at = null
      if (ft) {
        const anchorMs = new Date(toPkIso(date, ft)).getTime()
        start_at = new Date(
          block === 'pickup'
            ? anchorMs - cityBuffers.checkin * 60000 - durMs
            : anchorMs + cityBuffers.checkout * 60000,
        ).toISOString()
        end_at = new Date(new Date(start_at).getTime() + ((tripMin ?? 0) + BUFFER_MIN) * 60000).toISOString()
      }
      return {
        city_id: cityId,
        flight_id: flight.id,
        flight_no: flight.flight_no,
        flight_code: flight.flight_code || null,
        block_type: block,
        ride_date: date,
        duty_sheet_date: date,
        checkin_old: slot === 'checkin' ? ft || null : null,
        checkin_new: slot === 'checkin' ? ft || null : null,
        checkout_old: slot === 'checkout' ? ft || null : null,
        checkout_new: slot === 'checkout' ? ft || null : null,
        start_at,
        end_at,
        airport_name: airport.name || null,
        airport_lat: Number.isFinite(airport.lat) ? airport.lat : null,
        airport_lng: Number.isFinite(airport.lng) ? airport.lng : null,
        origin_label: crewList.length ? origin?.label || null : null,
        origin_lat: crewList.length ? origin?.lat ?? null : null,
        origin_lng: crewList.length ? origin?.lng ?? null : null,
        dest_label: crewList.length ? dest?.label || null : null,
        dest_lat: crewList.length ? dest?.lat ?? null : null,
        dest_lng: crewList.length ? dest?.lng ?? null : null,
        waypoints: crewList.length ? pts : [],
        route_geometry: info?.line ?? null,
        distance_km: totalKm,
        extra_km: info ? extraKm : 0,
        duration_min: tripMin,
        status: 'dispatched',
        created_by: createdBy ?? null,
      }
    })

    const { data, error } = await supabase.from('rides').insert(rows).select('id')
    if (error) {
      setBusy(false)
      return setErr(error.message)
    }
    if (crewList.length && data?.length) {
      const links = data.flatMap((r) => crewList.map((c, i) => ({ ride_id: r.id, crew_id: c.id, seq: i })))
      const rc = await supabase.from('ride_crew').insert(links)
      if (rc.error) {
        setBusy(false)
        return setErr(`Rides created but crew link failed: ${rc.error.message}`)
      }
    }
    setBusy(false)
    toast.success(`Created ${data.length} ride(s)`)
    onDone()
  }

  return (
    <Modal open onClose={onClose} title="Generate rides" width={520}>
      <div className="modal-form">
        {err && <div className="modal-error">{err}</div>}
        <p className="confirm-msg">
          Bulk-create rides from one flight across a date range. Vehicles are assigned
          per-ride afterwards.
        </p>

        <div className="field">
          <label>Flight</label>
          <SearchSelect
            value={flightId}
            onChange={setFlightId}
            options={flights.map((f) => ({
              value: f.id,
              label: `${f.flight_no}${f.flight_code ? ' · ' + f.flight_code : ''}`,
              sub: `${blockLabel(f.block_type)}${f.route ? ' · ' + f.route : ''}`,
            }))}
            placeholder="Search a flight…"
          />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="g-from">From</label>
            <input id="g-from" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="g-to">To</label>
            <input id="g-to" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label>Weekdays</label>
          <div className="radio-row">
            {WEEKDAYS.map((w) => (
              <label key={w.d} className="check-line">
                <input
                  type="checkbox"
                  checked={days[w.d]}
                  onChange={() => setDays((d) => ({ ...d, [w.d]: !d[w.d] }))}
                />
                {w.label}
              </label>
            ))}
          </div>
        </div>

        {flight && (
          <div className="field">
            <label>
              Crew for every ride <span className="badge badge-accent">{crewList.length}</span>{' '}
              <span className="field-hint">(optional — {blockLabel(block)})</span>
            </label>
            {crewList.length > 0 && (
              <ol className="ride-crew-list">
                {crewList.map((c, i) => (
                  <li key={c.id}>
                    <span className="ride-crew-seq">{i + 1}</span>
                    <span className="ride-crew-name">
                      ({c.ref_no}) {c.name}
                      {c.stop_name ? ` · ${c.stop_name}` : ''}
                    </span>
                    <button
                      type="button"
                      className="ride-crew-x"
                      onClick={() => setCrewList((cl) => cl.filter((x) => x.id !== c.id))}
                    >
                      <X size={13} />
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {(rule.max == null || crewList.length < rule.max) && (
              <SearchSelect
                value=""
                onChange={addCrew}
                options={cityCrew.map((c) => ({
                  value: c.id,
                  label: `(${c.ref_no}) ${c.name}`,
                  sub: c.stop_name || undefined,
                }))}
                placeholder="Add a crew member…"
              />
            )}
          </div>
        )}

        <div className="import-summary">
          Will create <b>{dates.length}</b> ride(s)
          {dates.length > 0 && (
            <>
              {' '}
              ({dates[0]}
              {dates.length > 1 ? ` … ${dates[dates.length - 1]}` : ''})
            </>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-square"
            disabled={busy || !flight || dates.length === 0}
            onClick={generate}
          >
            {busy ? 'Generating…' : `Generate ${dates.length}`}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function cityNameOf(cities, id) {
  return cities.find((c) => c.id === id)?.name || 'City'
}

function mapRideError(error, vehicleId, vehicles) {
  if (error.code === '23P01') {
    const v = vehicles.find((x) => x.id === vehicleId)
    return `Vehicle ${v?.vehicle_no ?? ''} is already booked for an overlapping time — pick another vehicle or change the window`
  }
  return error.message
}
