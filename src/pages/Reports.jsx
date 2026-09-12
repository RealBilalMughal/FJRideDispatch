import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Download } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { useCity } from '../context/useCity'
import { fmtDate } from '../lib/format'
import { fmtTimeOnly12, presetRange } from '../lib/time'
import {
  billableKm,
  blockLabel,
  crewNamesText,
  displayCrewCount,
  rideDriverText,
  rideVehicleText,
  statusLabel,
} from '../lib/rideRoute'
import { shiftLabel } from '../lib/shift'
import { downloadCsv, toCsv } from '../lib/csv'
import DateRangePicker from '../components/DateRangePicker'
import DataTable from '../components/data/DataTable'
import StatCards from '../components/data/StatCards'
import '../components/data/data.css'
import './Reports.css'

// Fixed display order, not row-insertion order - matches Ride Plan's own
// SUMMARY_BLOCKS convention.
const SUMMARY_BLOCKS = ['deadhead', 'pickup', 'dropoff', 'return_leg']

const RIDE_SELECT = `
  id, ref_no, city_id, flight_id, flight_no, flight_code, block_type,
  ride_date, duty_sheet_date, start_at, end_at, duration_min,
  distance_km, extra_km, status, cancel_reason, count_km, shift,
  vehicle_id, driver_id, is_adhoc_vehicle, adhoc_vehicle_no, adhoc_driver_name,
  vehicle:vehicles(vehicle_no),
  driver:drivers!rides_driver_id_fkey(name),
  ride_crew(seq, crew:crew(name))
`

const etaOf = (startAt, durMin) =>
  startAt && durMin != null ? new Date(new Date(startAt).getTime() + durMin * 60000).toISOString() : null

const fmtMonth = (ym) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })

const RIDE_SECTIONS = [
  { key: 'rides', label: 'Ride-wise' },
  { key: 'km', label: 'KM-wise' },
  { key: 'deadhead', label: 'Deadhead' },
  { key: 'pickup', label: 'Pickup' },
  { key: 'dropoff', label: 'Drop Off' },
  { key: 'return_leg', label: 'Return Leg' },
]
const PLAN_SECTION = { key: 'plan', label: 'Ride Plan vs Actual' }

export default function Reports() {
  const { can } = useAuth()
  const { cityId, cityName } = useCity()
  const canViewRides = can('rides', 'view')
  const canViewPlan = can('ride_plan', 'view')

  const sections = useMemo(
    () => [...(canViewRides ? RIDE_SECTIONS : []), ...(canViewPlan ? [PLAN_SECTION] : [])],
    [canViewRides, canViewPlan],
  )
  const [section, setSection] = useState(null)
  useEffect(() => {
    if (!section && sections.length) setSection(sections[0].key)
  }, [section, sections])

  const initialRange = presetRange('month')
  const [datePreset, setDatePreset] = useState('month')
  const [dateFrom, setDateFrom] = useState(initialRange.from)
  const [dateTo, setDateTo] = useState(initialRange.to)
  const onRangeChange = ({ preset, from, to }) => {
    setDatePreset(preset)
    setDateFrom(from)
    setDateTo(to)
  }

  const [planGroupBy, setPlanGroupBy] = useState('day') // 'day' | 'month'

  const [rows, setRows] = useState([])
  const [planRows, setPlanRows] = useState([])
  const [loading, setLoading] = useState(true)

  const isPlan = section === 'plan'

  // ride-based sections share one query - the section only changes how the
  // fetched rows are filtered/summarised below, not what's fetched.
  useEffect(() => {
    if (!canViewRides || isPlan || !section) return
    setLoading(true)
    let q = supabase.from('rides').select(RIDE_SELECT)
    if (dateFrom) q = q.gte('ride_date', dateFrom)
    if (dateTo) q = q.lte('ride_date', dateTo)
    if (cityId != null) q = q.eq('city_id', cityId)
    q.order('ride_date', { ascending: false })
      .order('start_at', { ascending: true })
      .then(({ data, error }) => {
        if (error) toast.error('Could not load the report')
        setRows(data ?? [])
        setLoading(false)
      })
  }, [canViewRides, isPlan, section, dateFrom, dateTo, cityId])

  useEffect(() => {
    if (!canViewPlan || !isPlan) return
    setLoading(true)
    let q = supabase
      .from('ride_plan_rows')
      .select('plan_date, block_type, planned_km, status, ride:rides(distance_km, status, count_km)')
    if (dateFrom) q = q.gte('plan_date', dateFrom)
    if (dateTo) q = q.lte('plan_date', dateTo)
    if (cityId != null) q = q.eq('city_id', cityId)
    q.then(({ data, error }) => {
      if (error) toast.error('Could not load the report')
      setPlanRows(data ?? [])
      setLoading(false)
    })
  }, [canViewPlan, isPlan, dateFrom, dateTo, cityId])

  const filteredRows = useMemo(() => {
    if (section === 'rides' || section === 'km' || isPlan) return rows
    return rows.filter((r) => r.block_type === section)
  }, [rows, section, isPlan])

  const summary = useMemo(() => {
    const byBlock = Object.fromEntries(SUMMARY_BLOCKS.map((b) => [b, { count: 0, km: 0 }]))
    let totalKm = 0
    for (const r of filteredRows) {
      const km = billableKm(r)
      totalKm += km
      if (byBlock[r.block_type]) {
        byBlock[r.block_type].count += 1
        byBlock[r.block_type].km += km
      }
    }
    return { byBlock, totalKm, totalCount: filteredRows.length }
  }, [filteredRows])

  const planSummary = useMemo(() => {
    const byBlock = Object.fromEntries(SUMMARY_BLOCKS.map((b) => [b, { plannedKm: 0, actualKm: 0, followed: 0, total: 0 }]))
    for (const r of planRows) {
      const b = byBlock[r.block_type]
      if (!b) continue
      b.total += 1
      b.plannedKm += Number(r.planned_km) || 0
      if (r.status === 'followed') {
        b.followed += 1
        b.actualKm += billableKm(r.ride || {})
      }
    }
    const total = Object.values(byBlock).reduce(
      (t, b) => ({
        plannedKm: t.plannedKm + b.plannedKm,
        actualKm: t.actualKm + b.actualKm,
        followed: t.followed + b.followed,
        total: t.total + b.total,
      }),
      { plannedKm: 0, actualKm: 0, followed: 0, total: 0 },
    )
    return { byBlock, total }
  }, [planRows])

  const planBreakdown = useMemo(() => {
    const keyOf = (d) => (planGroupBy === 'month' ? d.slice(0, 7) : d)
    const map = new Map()
    for (const r of planRows) {
      const k = keyOf(r.plan_date)
      const row = map.get(k) || { key: k, plannedKm: 0, actualKm: 0, followed: 0, total: 0 }
      row.total += 1
      row.plannedKm += Number(r.planned_km) || 0
      if (r.status === 'followed') {
        row.followed += 1
        row.actualKm += billableKm(r.ride || {})
      }
      map.set(k, row)
    }
    return [...map.values()].sort((a, b) => b.key.localeCompare(a.key))
  }, [planRows, planGroupBy])

  const rideColumns = [
    { key: 'date', header: 'Date', render: (r) => fmtDate(r.ride_date) },
    { key: 'ref', header: 'ID', render: (r) => r.ref_no },
    { key: 'flight', header: 'Flight', render: (r) => r.flight_no || '—' },
    { key: 'block', header: 'Block', render: (r) => blockLabel(r.block_type) },
    { key: 'crew', header: 'Crew', render: (r) => crewNamesText(r.ride_crew) },
    { key: 'count', header: 'Count', align: 'right', render: (r) => displayCrewCount(r.ride_crew, r.block_type) },
    { key: 'vehicle', header: 'Vehicle', render: (r) => rideVehicleText(r) },
    { key: 'shift', header: 'Shift', render: (r) => shiftLabel(r.shift) },
    { key: 'driver', header: 'Driver', render: (r) => rideDriverText(r) },
    { key: 'start', header: 'Ride Time', render: (r) => (r.start_at ? fmtTimeOnly12(r.start_at) : '—') },
    { key: 'eta', header: 'ETA', render: (r) => fmtTimeOnly12(etaOf(r.start_at, r.duration_min)) || '—' },
    { key: 'km', header: 'KM', align: 'right', render: (r) => (r.distance_km != null ? Number(r.distance_km).toFixed(2) : '—') },
    { key: 'billable', header: 'Billable KM', align: 'right', render: (r) => billableKm(r).toFixed(2) },
    { key: 'status', header: 'Status', render: (r) => statusLabel(r.status) },
  ]

  const planColumns = [
    {
      key: 'period',
      header: planGroupBy === 'month' ? 'Month' : 'Date',
      render: (r) => (planGroupBy === 'month' ? fmtMonth(r.key) : fmtDate(r.key)),
    },
    { key: 'total', header: 'Plan Rows', align: 'right', render: (r) => r.total },
    { key: 'followed', header: 'Followed', align: 'right', render: (r) => r.followed },
    { key: 'planned', header: 'Planned KM', align: 'right', render: (r) => r.plannedKm.toFixed(2) },
    { key: 'actual', header: 'Actual KM', align: 'right', render: (r) => r.actualKm.toFixed(2) },
    {
      key: 'delta',
      header: 'Difference',
      align: 'right',
      render: (r) => {
        const d = r.actualKm - r.plannedKm
        return <span className={`status-text ${d > 0 ? 'bad' : 'on'}`}>{d.toFixed(2)}</span>
      },
    },
  ]

  const exportCsv = () => {
    const tag = cityId == null ? 'all' : cityName.toLowerCase()
    if (isPlan) {
      const cols = planColumns.map((c) => ({ key: c.key, label: c.header }))
      const data = planBreakdown.map((r) => ({
        period: planGroupBy === 'month' ? fmtMonth(r.key) : fmtDate(r.key),
        total: r.total,
        followed: r.followed,
        planned: r.plannedKm.toFixed(2),
        actual: r.actualKm.toFixed(2),
        delta: (r.actualKm - r.plannedKm).toFixed(2),
      }))
      downloadCsv(`report-plan-vs-actual-${tag}.csv`, toCsv(cols, data))
    } else {
      const cols = rideColumns.map((c) => ({ key: c.key, label: c.header }))
      const data = filteredRows.map((r) => ({
        date: fmtDate(r.ride_date),
        ref: r.ref_no,
        flight: r.flight_no || '',
        block: blockLabel(r.block_type),
        crew: crewNamesText(r.ride_crew),
        count: displayCrewCount(r.ride_crew, r.block_type),
        vehicle: rideVehicleText(r),
        shift: shiftLabel(r.shift),
        driver: rideDriverText(r),
        start: r.start_at ? fmtTimeOnly12(r.start_at) : '',
        eta: fmtTimeOnly12(etaOf(r.start_at, r.duration_min)),
        km: r.distance_km != null ? Number(r.distance_km).toFixed(2) : '',
        billable: billableKm(r).toFixed(2),
        status: statusLabel(r.status),
      }))
      downloadCsv(`report-${section}-${tag}.csv`, toCsv(cols, data))
    }
    toast.success('Report exported')
  }

  if (!canViewRides && !canViewPlan) {
    return (
      <div className="page">
        <h1 className="page-title">Reports</h1>
        <p className="page-subtitle">You don&rsquo;t have access to this page.</p>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-subtitle">{cityName}</p>
        </div>
        <div className="page-actions">
          <DateRangePicker preset={datePreset} from={dateFrom} to={dateTo} onChange={onRangeChange} />
          <button className="btn btn-ghost btn-square btn-sm" onClick={exportCsv}>
            <Download size={14} /> Export CSV
          </button>
        </div>
      </div>

      <div className="rpt-layout">
        <div className="rpt-list">
          <div className="rpt-list-head">Reports</div>
          {sections.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`rpt-list-item${section === s.key ? ' on' : ''}`}
              onClick={() => setSection(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="rpt-panel">
          {isPlan ? (
            <>
              <StatCards
                items={[
                  {
                    key: 'total',
                    label: 'Total',
                    value: `${planSummary.total.plannedKm.toFixed(2)} km`,
                    hint: `Actual: ${planSummary.total.actualKm.toFixed(2)} km (${planSummary.total.followed} followed)`,
                    active: true,
                  },
                  ...SUMMARY_BLOCKS.map((b) => ({
                    key: b,
                    label: blockLabel(b),
                    value: `${planSummary.byBlock[b].plannedKm.toFixed(2)} km`,
                    hint: `Actual: ${planSummary.byBlock[b].actualKm.toFixed(2)} km (${planSummary.byBlock[b].followed} followed)`,
                  })),
                ]}
              />
              <div className="rpt-subbar">
                <span className="rpt-subbar-label">Breakdown</span>
                <div className="date-tabs">
                  <button
                    type="button"
                    className={planGroupBy === 'day' ? 'on' : ''}
                    onClick={() => setPlanGroupBy('day')}
                  >
                    By day
                  </button>
                  <button
                    type="button"
                    className={planGroupBy === 'month' ? 'on' : ''}
                    onClick={() => setPlanGroupBy('month')}
                  >
                    By month
                  </button>
                </div>
              </div>
              <DataTable
                columns={planColumns}
                rows={planBreakdown}
                rowKey={(r) => r.key}
                loading={loading}
                emptyLabel="No plan data in this range"
              />
            </>
          ) : (
            <>
              <StatCards
                items={[
                  {
                    key: 'total',
                    label: 'Total',
                    value: `${summary.totalCount} rides`,
                    hint: `${summary.totalKm.toFixed(2)} km`,
                    active: true,
                  },
                  ...SUMMARY_BLOCKS.map((b) => ({
                    key: b,
                    label: blockLabel(b),
                    value: `${summary.byBlock[b].count}`,
                    hint: `${summary.byBlock[b].km.toFixed(2)} km`,
                  })),
                ]}
              />
              <DataTable
                columns={rideColumns}
                rows={filteredRows}
                rowKey={(r) => r.id}
                loading={loading}
                emptyLabel="No rides in this range"
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
