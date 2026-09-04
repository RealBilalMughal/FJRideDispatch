import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Download,
  Eye,
  Navigation,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Route as RouteIcon,
  Shield,
  Trash2,
  X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { useCity } from '../context/useCity'
import { useEntityRows } from '../lib/useEntityRows'
import { useSelection } from '../lib/useSelection'
import { fmtDate } from '../lib/format'
import { fmtTime12, fmtTimeOnly12, isoToLocalTime, toPkIso, toTime24 } from '../lib/time'
import {
  BLOCK_TYPES,
  RIDE_STATUS,
  blockLabel,
  buildRoutePoints,
  crewRule,
  primaryTimeSlot,
  routeComplete,
  statusLabel,
} from '../lib/rideRoute'
import { gmapsRoute, routeInfo } from '../lib/ors'
import { downloadCsv, toCsv } from '../lib/csv'
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
const BUFFER_MIN = 30 // turnaround buffer around a ride's road time
const NIL = '00000000-0000-0000-0000-000000000000'

const SELECT = `
  id, ref_no, city_id, flight_id, flight_no, flight_code, block_type, deadhead_mode,
  ride_date, checkin_old, checkin_new, checkout_old, checkout_new, start_at, end_at,
  vehicle_id, airport_name, airport_lat, airport_lng,
  origin_label, origin_lat, origin_lng, dest_label, dest_lat, dest_lng,
  waypoints, distance_km, duration_min, status, return_of_ride_id, notes, created_at,
  city:cities(name),
  vehicle:vehicles(ref_no, vehicle_no, driver:drivers(ref_no, name)),
  ride_crew(seq, crew:crew(id, ref_no, name, stop_name, stop_lat, stop_lng))
`

const EXPORT_COLS = [
  { key: 'ref_no', label: 'ID' },
  { key: 'ride_date', label: 'Date' },
  { key: 'flight_no', label: 'Flight No' },
  { key: 'flight_code', label: 'Code' },
  { key: 'block', label: 'Block' },
  { key: 'checkin_old', label: 'Check-in (old)' },
  { key: 'checkin_new', label: 'Check-in (new)' },
  { key: 'checkout_old', label: 'Check-out (old)' },
  { key: 'checkout_new', label: 'Check-out (new)' },
  { key: 'crew', label: 'Crew' },
  { key: 'origin', label: 'Origin' },
  { key: 'dest', label: 'Destination' },
  { key: 'vehicle', label: 'Vehicle' },
  { key: 'km', label: 'KM' },
  { key: 'window', label: 'Window' },
  { key: 'status', label: 'Status' },
]

const crewNames = (rc) =>
  [...(rc || [])]
    .sort((a, b) => a.seq - b.seq)
    .map((x) => x.crew?.name)
    .filter(Boolean)
    .join(', ')

const vehicleText = (v) => (v ? `(${v.ref_no}) ${v.vehicle_no}` : '—')

export default function Rides() {
  const { can, profile } = useAuth()
  const { allowedCities, cityId, cityName } = useCity()

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
      .select('id, ref_no, vehicle_no, city_id, is_active, driver:drivers(ref_no, name)')
      .then(({ data }) => setVehicles((data ?? []).filter((v) => v.is_active)))
  }, [canView])

  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [blockFilter, setBlockFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('')

  const [addOpen, setAddOpen] = useState(false)
  const [detail, setDetail] = useState(null) // { row, edit }
  const [pending, setPending] = useState(null) // { ids, label }
  const [deleting, setDeleting] = useState(false)
  const [returnFor, setReturnFor] = useState(null) // a dropoff ride
  const [returnBusy, setReturnBusy] = useState(false)
  const { selected, toggle, toggleAll, clear } = useSelection()

  const list = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        city_name: r.city?.name ?? '',
        crew_text: crewNames(r.ride_crew) || '—',
        vehicle_text: vehicleText(r.vehicle),
      })),
    [rows],
  )

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    return list.filter((r) => {
      if (blockFilter !== 'all' && r.block_type !== blockFilter) return false
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (dateFilter && r.ride_date !== dateFilter) return false
      if (
        s &&
        !`${r.ref_no} ${r.flight_no ?? ''} ${r.flight_code ?? ''} ${r.crew_text} ${r.vehicle?.vehicle_no ?? ''}`
          .toLowerCase()
          .includes(s)
      )
        return false
      return true
    })
  }, [list, search, blockFilter, statusFilter, dateFilter])

  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const stats = useMemo(
    () => ({
      total: list.length,
      scheduled: list.filter((r) => r.status === 'scheduled').length,
      completed: list.filter((r) => r.status === 'completed').length,
    }),
    [list],
  )

  const setStatus = async (row, next) => {
    const { error } = await supabase.from('rides').update({ status: next }).eq('id', row.id)
    if (error) return toast.error(error.message)
    toast.success('Status updated')
    fetchRows()
  }

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

  const doReturnLeg = async () => {
    if (!returnFor) return
    setReturnBusy(true)
    try {
      const r = returnFor
      const lastCrew = [...(r.ride_crew || [])].sort((a, b) => a.seq - b.seq).pop()?.crew
      if (!lastCrew) throw new Error('This ride has no crew to return')
      const airport = { name: r.airport_name, lat: Number(r.airport_lat), lng: Number(r.airport_lng) }
      const pts = [
        {
          seq: 0,
          kind: 'crew',
          crew_id: lastCrew.id,
          label: `${lastCrew.name}${lastCrew.stop_name ? ' · ' + lastCrew.stop_name : ''}`,
          lat: Number(lastCrew.stop_lat),
          lng: Number(lastCrew.stop_lng),
        },
        { seq: 1, kind: 'airport', label: airport.name || 'Airport', lat: airport.lat, lng: airport.lng },
      ]
      const info = routeComplete(pts) ? await routeInfo(pts.map((p) => [p.lng, p.lat])) : null
      const start_at = r.end_at || toPkIso(r.ride_date, r.checkout_new || r.checkout_old || '12:00')
      const dur = (info?.durationMin ?? 30) + BUFFER_MIN
      const end_at = start_at ? new Date(new Date(start_at).getTime() + dur * 60000).toISOString() : null

      const { data: ride, error } = await supabase
        .from('rides')
        .insert({
          city_id: r.city_id,
          flight_id: r.flight_id,
          flight_no: r.flight_no,
          flight_code: r.flight_code,
          block_type: 'return_leg',
          ride_date: r.ride_date,
          vehicle_id: r.vehicle_id,
          airport_name: airport.name,
          airport_lat: airport.lat,
          airport_lng: airport.lng,
          origin_label: pts[0].label,
          origin_lat: pts[0].lat,
          origin_lng: pts[0].lng,
          dest_label: pts[1].label,
          dest_lat: pts[1].lat,
          dest_lng: pts[1].lng,
          waypoints: pts,
          distance_km: info?.distanceKm ?? null,
          duration_min: info?.durationMin ?? null,
          start_at,
          end_at,
          status: 'scheduled',
          return_of_ride_id: r.id,
          created_by: profile?.id ?? null,
        })
        .select('id')
        .single()
      if (error) {
        throw new Error(
          error.code === '23P01'
            ? `Vehicle ${r.vehicle?.vehicle_no ?? ''} is busy at that time on another ride`
            : error.message,
        )
      }
      await supabase.from('ride_crew').insert({ ride_id: ride.id, crew_id: lastCrew.id, seq: 0 })
      toast.success('Return leg ride created')
      setReturnFor(null)
      fetchRows()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setReturnBusy(false)
    }
  }

  const exportCsv = () => {
    const data = filtered.map((r) => ({
      ref_no: r.ref_no,
      ride_date: r.ride_date,
      flight_no: r.flight_no ?? '',
      flight_code: r.flight_code ?? '',
      block: blockLabel(r.block_type),
      checkin_old: fmtTime12(r.checkin_old),
      checkin_new: fmtTime12(r.checkin_new),
      checkout_old: fmtTime12(r.checkout_old),
      checkout_new: fmtTime12(r.checkout_new),
      crew: r.crew_text,
      origin: r.origin_label ?? '',
      dest: r.dest_label ?? '',
      vehicle: r.vehicle?.vehicle_no ?? '',
      km: r.distance_km ?? '',
      window:
        r.start_at && r.end_at
          ? `${fmtTimeOnly12(r.start_at)}–${fmtTimeOnly12(r.end_at)}`
          : '',
      status: statusLabel(r.status),
    }))
    const tag = cityId == null ? 'all' : cityName.toLowerCase()
    downloadCsv(`rides-${tag}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(EXPORT_COLS, data))
    toast.success(`Exported ${data.length} row(s)`)
  }

  if (!canView) {
    return (
      <div className="page">
        <div className="card placeholder-card">
          <Shield size={28} color="var(--muted)" />
          <h2>No access</h2>
          <p>You don&rsquo;t have permission to view Ride Dispatch.</p>
        </div>
      </div>
    )
  }

  const t12 = (t) => fmtTime12(t) || '—'
  const columns = [
    { key: 'ref', header: 'ID', render: (r) => <span className="primary">{r.ref_no}</span> },
    { key: 'date', header: 'Date', render: (r) => fmtDate(r.ride_date) },
    { key: 'fno', header: 'Flight No', render: (r) => r.flight_no || '—' },
    { key: 'fcode', header: 'Code', render: (r) => r.flight_code || '—' },
    { key: 'block', header: 'Block', render: (r) => blockLabel(r.block_type) },
    { key: 'cio', header: 'Check-in (old)', render: (r) => t12(r.checkin_old) },
    { key: 'cin', header: 'Check-in (new)', render: (r) => t12(r.checkin_new) },
    { key: 'coo', header: 'Check-out (old)', render: (r) => t12(r.checkout_old) },
    { key: 'con', header: 'Check-out (new)', render: (r) => t12(r.checkout_new) },
    { key: 'crew', header: 'Crew', render: (r) => r.crew_text },
    { key: 'origin', header: 'Origin', render: (r) => r.origin_label || '—' },
    { key: 'dest', header: 'Destination', render: (r) => r.dest_label || '—' },
    { key: 'veh', header: 'Vehicle', render: (r) => r.vehicle_text },
    {
      key: 'km',
      header: 'KM',
      render: (r) => (r.distance_km != null ? `${r.distance_km} km` : '—'),
    },
    {
      key: 'win',
      header: 'Window',
      render: (r) =>
        r.start_at && r.end_at ? `${fmtTimeOnly12(r.start_at)}–${fmtTimeOnly12(r.end_at)}` : '—',
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) =>
        canEdit ? (
          <select
            className="inline-select"
            value={r.status}
            onChange={(e) => setStatus(r, e.target.value)}
          >
            {RIDE_STATUS.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        ) : (
          statusLabel(r.status)
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => {
        const gm = gmapsRoute(r.waypoints)
        return (
          <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
            {r.block_type === 'dropoff' && canAdd && (
              <button title="Create return leg" onClick={() => setReturnFor(r)}>
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
            {canEdit && (
              <button title="Edit" onClick={() => setDetail({ row: r, edit: true })}>
                <Pencil size={13} />
              </button>
            )}
            {canDelete && (
              <button
                title="Delete"
                className="danger"
                onClick={() => setPending({ ids: [r.id], label: `ride ${r.ref_no}` })}
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
          <h1 className="page-title">Ride Dispatch</h1>
          <p className="page-subtitle">
            {stats.total} ride(s) · {cityName}
          </p>
        </div>
        <div className="page-actions">
          <button className="icon-btn" onClick={fetchRows} title="Refresh">
            <RefreshCw size={15} />
          </button>
          <button className="btn btn-ghost btn-square btn-sm" onClick={exportCsv}>
            <Download size={14} /> Export
          </button>
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
          { key: 'sched', label: 'Scheduled', value: stats.scheduled, icon: RouteIcon },
          { key: 'done', label: 'Completed', value: stats.completed, icon: RouteIcon },
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
          (blockFilter !== 'all' ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0) + (dateFilter ? 1 : 0)
        }
        onClear={() => {
          setBlockFilter('all')
          setStatusFilter('all')
          setDateFilter('')
          setSearch('')
          setPage(1)
        }}
        inline={
          <>
            <input
              type="date"
              className="filter-select"
              value={dateFilter}
              onChange={(e) => {
                setDateFilter(e.target.value)
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
            <select
              className="filter-select"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value)
                setPage(1)
              }}
            >
              <option value="all">All status</option>
              {RIDE_STATUS.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
          </>
        }
      />

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
          allowedCities={allowedCities}
          defaultCityId={cityId}
          createdBy={profile?.id}
          onClose={() => setAddOpen(false)}
          onDone={() => {
            setAddOpen(false)
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
          allowedCities={allowedCities}
          createdBy={profile?.id}
          onClose={() => setDetail(null)}
          onDone={() => {
            setDetail(null)
            fetchRows()
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(returnFor)}
        title="Create return leg"
        confirmLabel="Create return ride"
        busyLabel="Creating…"
        busy={returnBusy}
        message={
          returnFor
            ? `Create a return-leg ride: ${returnFor.dest_label || 'last stop'} → ${
                returnFor.airport_name || 'Airport'
              }, on the same vehicle (${returnFor.vehicle?.vehicle_no || '—'}).`
            : ''
        }
        onConfirm={doReturnLeg}
        onClose={() => !returnBusy && setReturnFor(null)}
      />

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

// ── Ride form ─────────────────────────────────────────────────────────────
function RideModal({
  row,
  startInEdit = false,
  canEdit = true,
  flights,
  crew,
  vehicles,
  allowedCities,
  defaultCityId,
  createdBy,
  onClose,
  onDone,
}) {
  const isAdd = !row
  const [editing, setEditing] = useState(isAdd || startInEdit)

  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [routeData, setRouteData] = useState(null) // { distanceKm, durationMin, line }
  const [conflict, setConflict] = useState(null) // { ref_no, end_at }
  const [winTouched, setWinTouched] = useState(false)

  const initialCrew = [...(row?.ride_crew || [])]
    .sort((a, b) => a.seq - b.seq)
    .map((x) => x.crew)
    .filter(Boolean)

  const [form, setForm] = useState({
    flight_id: row?.flight_id ?? '',
    flight_no: row?.flight_no ?? '',
    flight_code: row?.flight_code ?? '',
    block_type: row?.block_type ?? '',
    deadhead_mode: row?.deadhead_mode ?? 'airport',
    city_id: row?.city_id ?? defaultCityId ?? allowedCities[0]?.id ?? '',
    ride_date: row?.ride_date ?? new Date().toISOString().slice(0, 10),
    checkin_old: toTime24(row?.checkin_old),
    checkin_new: toTime24(row?.checkin_new),
    checkout_old: toTime24(row?.checkout_old),
    checkout_new: toTime24(row?.checkout_new),
    start_time: row?.start_at ? isoToLocalTime(row.start_at) : '',
    end_time: row?.end_at ? isoToLocalTime(row.end_at) : '',
    vehicle_id: row?.vehicle_id ?? '',
    status: row?.status ?? 'scheduled',
    notes: row?.notes ?? '',
  })
  const [crewList, setCrewList] = useState(initialCrew)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const cityId = Number(form.city_id) || null
  const airport = useMemo(() => {
    const c = allowedCities.find((x) => x.id === cityId)
    return { name: c?.airport_name || '', lat: Number(c?.airport_lat), lng: Number(c?.airport_lng) }
  }, [allowedCities, cityId])

  const rule = crewRule(form.block_type, form.deadhead_mode)
  const routePoints = useMemo(
    () => buildRoutePoints(form.block_type, form.deadhead_mode, crewList.map((c) => ({ ...c, crew_id: c.id })), airport),
    [form.block_type, form.deadhead_mode, crewList, airport],
  )
  const routeReady = routeComplete(routePoints)

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

  // fetch the ORS route whenever the ordered points are complete
  useEffect(() => {
    if (!routeReady) {
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
  }, [routeReady, routePoints])

  // auto-suggest the vehicle window from the block + primary time + road duration
  useEffect(() => {
    if (winTouched) return
    const dur = (routeData?.durationMin ?? 0) + BUFFER_MIN
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
    if (form.block_type === 'pickup') {
      set('end_time', anchor)
      set('start_time', fmt(mins - dur))
    } else if (form.block_type === 'dropoff') {
      set('start_time', anchor)
      set('end_time', fmt(mins + dur))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeData, form.block_type, form.checkin_new, form.checkin_old, form.checkout_new, form.checkout_old])

  const startAt = toPkIso(form.ride_date, form.start_time)
  const endAt = toPkIso(form.ride_date, form.end_time)

  // vehicle conflict pre-check
  useEffect(() => {
    if (!form.vehicle_id || !startAt || !endAt) {
      setConflict(null)
      return
    }
    let alive = true
    supabase
      .from('rides')
      .select('ref_no, start_at, end_at')
      .eq('vehicle_id', form.vehicle_id)
      .lt('start_at', endAt)
      .gt('end_at', startAt)
      .neq('id', row?.id ?? NIL)
      .then(({ data }) => {
        if (alive) setConflict(data?.[0] || null)
      })
    return () => {
      alive = false
    }
  }, [form.vehicle_id, startAt, endAt, row?.id])

  const cityCrew = crew.filter((c) => c.city_id === cityId && !crewList.some((x) => x.id === c.id))
  const cityVehicles = vehicles.filter((v) => v.city_id === cityId)

  const addCrew = (id) => {
    const c = crew.find((x) => x.id === id)
    if (!c) return
    if (rule.max != null && crewList.length >= rule.max) return
    setCrewList((cl) => [...cl, c])
  }
  const removeCrew = (id) => setCrewList((cl) => cl.filter((c) => c.id !== id))

  const origin = routePoints[0]
  const dest = routePoints[routePoints.length - 1]
  const km = routeData?.distanceKm ?? row?.distance_km ?? null
  const durationMin = routeData?.durationMin ?? row?.duration_min ?? null

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (!form.flight_id) return setErr('Pick a flight')
    if (!form.block_type) return setErr('Pick a block type')
    if (!cityId) return setErr('Pick a city')
    if (crewList.length < rule.min) return setErr(`This block needs at least ${rule.min} crew`)
    if (rule.max != null && crewList.length > rule.max)
      return setErr(`This block takes exactly ${rule.max} crew`)
    if (!routeReady) return setErr('Route is incomplete — check the crew stops and airport have coordinates')
    if (form.vehicle_id && (!startAt || !endAt))
      return setErr('Set the ride start and end time for the vehicle')
    if (form.vehicle_id && conflict)
      return setErr(`Vehicle busy on Ride ${conflict.ref_no} till ${fmtTimeOnly12(conflict.end_at)}`)

    setBusy(true)
    const payload = {
      city_id: cityId,
      flight_id: form.flight_id,
      flight_no: form.flight_no,
      flight_code: form.flight_code || null,
      block_type: form.block_type,
      deadhead_mode: form.block_type === 'deadhead' ? form.deadhead_mode : null,
      ride_date: form.ride_date,
      checkin_old: form.checkin_old || null,
      checkin_new: form.checkin_new || form.checkin_old || null,
      checkout_old: form.checkout_old || null,
      checkout_new: form.checkout_new || form.checkout_old || null,
      start_at: startAt,
      end_at: endAt,
      vehicle_id: form.vehicle_id || null,
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
      distance_km: km,
      duration_min: durationMin,
      status: form.status,
      notes: form.notes.trim() || null,
    }
    let rideId = row?.id
    if (isAdd) {
      const res = await supabase
        .from('rides')
        .insert({ ...payload, created_by: createdBy ?? null })
        .select('id')
        .single()
      if (res.error) {
        setBusy(false)
        return setErr(mapRideError(res.error, form.vehicle_id, cityVehicles))
      }
      rideId = res.data.id
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
    setBusy(false)
    toast.success(isAdd ? 'Ride created' : 'Ride updated')
    onDone()
  }

  const title = isAdd
    ? 'Add Ride'
    : editing
      ? `Edit ride ${row.ref_no}`
      : `Ride ${row.ref_no} · ${blockLabel(row.block_type)}`

  // ---- read-only view ----
  if (!editing) {
    const gm = gmapsRoute(row.waypoints)
    return (
      <Modal open onClose={onClose} title={title} width={560}>
        <div className="modal-form">
          {[
            ['Flight', `${row.flight_no || '—'}${row.flight_code ? ' · ' + row.flight_code : ''}`],
            ['Block', blockLabel(row.block_type)],
            ['Date', fmtDate(row.ride_date)],
            ['Check-in', `${fmtTime12(row.checkin_old) || '—'}  →  ${fmtTime12(row.checkin_new) || '—'}`],
            ['Check-out', `${fmtTime12(row.checkout_old) || '—'}  →  ${fmtTime12(row.checkout_new) || '—'}`],
            ['Crew', crewNames(row.ride_crew) || '—'],
            ['Origin', row.origin_label || '—'],
            ['Destination', row.dest_label || '—'],
            ['Vehicle', row.vehicle ? `(${row.vehicle.ref_no}) ${row.vehicle.vehicle_no}` : '—'],
            ['Driver', row.vehicle?.driver ? `(${row.vehicle.driver.ref_no}) ${row.vehicle.driver.name}` : '—'],
            ['Distance', row.distance_km != null ? `${row.distance_km} km` : '—'],
            [
              'Window',
              row.start_at && row.end_at
                ? `${fmtTimeOnly12(row.start_at)} – ${fmtTimeOnly12(row.end_at)}`
                : '—',
            ],
            ['Status', statusLabel(row.status)],
          ].map(([k, v]) => (
            <div className="view-row" key={k}>
              <span className="view-label">{k}</span>
              <span className="view-value">{v}</span>
            </div>
          ))}

          <RouteMap points={row.waypoints || []} height={200} />
          {gm && (
            <a className="btn btn-ghost btn-square btn-sm" href={gm} target="_blank" rel="noreferrer">
              <Navigation size={13} /> Open route in Google Maps
            </a>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
              Close
            </button>
            {canEdit && (
              <button type="button" className="btn btn-square" onClick={() => setEditing(true)}>
                <Pencil size={13} /> Edit
              </button>
            )}
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
    label: `(${v.ref_no}) ${v.vehicle_no}`,
    sub: v.driver ? `driver: ${v.driver.name}` : 'no driver',
  }))

  return (
    <Modal open onClose={onClose} title={title} width={620}>
      <form className="modal-form" onSubmit={submit}>
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

        <div className="field-row">
          <div className="field">
            <label htmlFor="r-cin">Check-in time</label>
            <input
              id="r-cin"
              type="time"
              className="input"
              value={form.checkin_new}
              onChange={(e) => set('checkin_new', e.target.value)}
            />
            {form.checkin_old && form.checkin_old !== form.checkin_new && (
              <span className="field-hint">was {fmtTime12(form.checkin_old)}</span>
            )}
          </div>
          <div className="field">
            <label htmlFor="r-cout">Check-out time</label>
            <input
              id="r-cout"
              type="time"
              className="input"
              value={form.checkout_new}
              onChange={(e) => set('checkout_new', e.target.value)}
            />
            {form.checkout_old && form.checkout_old !== form.checkout_new && (
              <span className="field-hint">was {fmtTime12(form.checkout_old)}</span>
            )}
          </div>
        </div>

        {/* crew */}
        <div className="field">
          <label>
            Crew{' '}
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
        </div>

        {/* route preview */}
        <div className="field">
          <label>
            Route{' '}
            {km != null && (
              <span className="ride-km-badge">
                {km} km{durationMin != null ? ` · ${durationMin} min` : ''}
              </span>
            )}
          </label>
          <RouteMap points={routePoints} line={routeData?.line} height={200} />
          {routePoints.length >= 2 && (
            <span className="field-hint">
              {origin?.label} → {routePoints.slice(1, -1).map((p) => p.label).join(' → ') || ''}
              {routePoints.length > 2 ? ' → ' : ''}
              {dest?.label}
            </span>
          )}
        </div>

        {/* vehicle + window */}
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

        <div className="field-row">
          <div className="field">
            <label htmlFor="r-start">Ride starts</label>
            <input
              id="r-start"
              type="time"
              className="input"
              value={form.start_time}
              onChange={(e) => {
                setWinTouched(true)
                set('start_time', e.target.value)
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="r-end">Ride ends</label>
            <input
              id="r-end"
              type="time"
              className="input"
              value={form.end_time}
              onChange={(e) => {
                setWinTouched(true)
                set('end_time', e.target.value)
              }}
            />
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="r-status">Status</label>
            <select
              id="r-status"
              className="select"
              value={form.status}
              onChange={(e) => set('status', e.target.value)}
            >
              {RIDE_STATUS.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
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

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-square" disabled={busy || Boolean(conflict)}>
            {busy ? 'Saving…' : isAdd ? 'Create ride' : 'Save'}
          </button>
        </div>
      </form>
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
