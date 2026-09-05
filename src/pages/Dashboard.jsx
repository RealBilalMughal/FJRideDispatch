import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDownRight,
  ArrowUpRight,
  Milestone,
  Moon,
  PlaneLanding,
  PlaneTakeoff,
  RotateCcw,
  Route as RouteIcon,
  Sun,
  Users2,
  Waypoints,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { useCity } from '../context/useCity'
import { fmtDate } from '../lib/format'
import { addDays, fmtTimeOnly12, pkToday, presetRange } from '../lib/time'
import { blockLabel, displayCrewCount } from '../lib/rideRoute'
import './Dashboard.css'

const DATE_PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'all', label: 'All' },
]
const BLOCKS = [
  { key: 'pickup', icon: PlaneTakeoff },
  { key: 'dropoff', icon: PlaneLanding },
  { key: 'deadhead', icon: Waypoints },
  { key: 'return_leg', icon: RotateCcw },
]
const km = (r) => Number(r.distance_km) || 0
const fmtKm = (n) => `${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} km`
const firstCrewName = (rc) =>
  [...(rc || [])].sort((a, b) => a.seq - b.seq).map((x) => x.crew?.name).filter(Boolean)[0] || ''

// list every "YYYY-MM-DD" from `from` to `to` inclusive
function dateList(from, to) {
  if (!from || !to || from > to) return []
  const out = []
  let d = from
  for (let i = 0; d <= to && i < 400; i++) {
    out.push(d)
    d = addDays(d, 1)
  }
  return out
}

// aggregate a ride list into the numbers the cards/sections need
function rollup(rows) {
  const blk = Object.fromEntries(BLOCKS.map((b) => [b.key, { count: 0, km: 0 }]))
  const shift = { day: { count: 0, km: 0 }, night: { count: 0, km: 0 } }
  let crew = 0
  let totalKm = 0
  for (const r of rows) {
    totalKm += km(r)
    crew += displayCrewCount(r.ride_crew, r.block_type)
    if (blk[r.block_type]) {
      blk[r.block_type].count += 1
      blk[r.block_type].km += km(r)
    }
    if (shift[r.shift]) {
      shift[r.shift].count += 1
      shift[r.shift].km += km(r)
    }
  }
  return { total: rows.length, totalKm, crew, blk, shift }
}

const RANGE_SELECT = 'block_type, distance_km, shift, ride_date, city_id, city:cities(name), ride_crew(seq)'
const LIVE_SELECT =
  'id, ref_no, block_type, start_at, end_at, vehicle:vehicles(vehicle_no), ride_crew(seq, crew:crew(name))'

export default function Dashboard() {
  const { profile, can } = useAuth()
  const { cityId, cityName, ready } = useCity()
  const canRides = can('rides', 'view')
  const name = (profile?.full_name || '').split(' ')[0]

  const [preset, setPreset] = useState('today')
  const initial = presetRange('today')
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)

  const [rows, setRows] = useState([])
  const [prevRows, setPrevRows] = useState([])
  const [live, setLive] = useState([])
  const [loading, setLoading] = useState(true)

  // main range + the equivalent previous period (for the trend %)
  useEffect(() => {
    if (!ready || !canRides) return
    let alive = true
    setLoading(true)
    const run = async () => {
      const scope = (q) => (cityId != null ? q.eq('city_id', cityId) : q)
      let cur = scope(supabase.from('rides').select(RANGE_SELECT))
      if (from) cur = cur.gte('ride_date', from)
      if (to) cur = cur.lte('ride_date', to)

      let prev = null
      if (from && to) {
        const span = dateList(from, to).length
        const prevTo = addDays(from, -1)
        const prevFrom = addDays(prevTo, -(span - 1))
        prev = scope(supabase.from('rides').select('block_type, distance_km, ride_crew(seq)'))
          .gte('ride_date', prevFrom)
          .lte('ride_date', prevTo)
      }

      const [{ data: cd }, pv] = await Promise.all([cur, prev ?? Promise.resolve({ data: [] })])
      if (!alive) return
      setRows(cd ?? [])
      setPrevRows(pv.data ?? [])
      setLoading(false)
    }
    run()
    return () => {
      alive = false
    }
  }, [ready, canRides, from, to, cityId])

  // today's rides for the live strip - always today, independent of the range
  useEffect(() => {
    if (!ready || !canRides) return
    let alive = true
    let q = supabase.from('rides').select(LIVE_SELECT).eq('ride_date', pkToday())
    if (cityId != null) q = q.eq('city_id', cityId)
    q.then(({ data }) => {
      if (alive) setLive(data ?? [])
    })
    return () => {
      alive = false
    }
  }, [ready, canRides, cityId])

  const applyPreset = (p) => {
    const r = presetRange(p)
    setPreset(p)
    setFrom(r.from)
    setTo(r.to)
  }

  const s = useMemo(() => rollup(rows), [rows])
  const p = useMemo(() => rollup(prevRows), [prevRows])
  const hasPrev = Boolean(from && to) && prevRows.length > 0

  const deadheadPct = s.totalKm > 0 ? (s.blk.deadhead.km / s.totalKm) * 100 : 0
  const prevDeadheadPct = p.totalKm > 0 ? (p.blk.deadhead.km / p.totalKm) * 100 : 0

  const perDay = useMemo(() => {
    const days = dateList(from, to)
    if (days.length < 2) return []
    const byDate = new Map(days.map((d) => [d, 0]))
    for (const r of rows) if (byDate.has(r.ride_date)) byDate.set(r.ride_date, byDate.get(r.ride_date) + 1)
    return days.map((d) => ({ date: d, count: byDate.get(d) }))
  }, [rows, from, to])

  const byCity = useMemo(() => {
    if (cityId != null) return []
    const m = new Map()
    for (const r of rows) {
      const nm = r.city?.name || '—'
      const cur = m.get(nm) || { count: 0, km: 0 }
      cur.count += 1
      cur.km += km(r)
      m.set(nm, cur)
    }
    return [...m.entries()].sort((a, b) => b[1].count - a[1].count)
  }, [rows, cityId])

  const liveRows = useMemo(() => {
    const now = Date.now()
    return live
      .filter((r) => {
        const end = r.end_at ? new Date(r.end_at).getTime() : null
        return end == null || end > now - 90 * 60000
      })
      .sort((a, b) => new Date(a.start_at || 0) - new Date(b.start_at || 0))
      .slice(0, 8)
  }, [live])

  const num = (x) => (loading ? '…' : x)
  const rangeLabel =
    preset === 'all'
      ? 'all time'
      : preset
        ? DATE_PRESETS.find((x) => x.value === preset)?.label.toLowerCase()
        : 'custom range'

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">
            {name ? `Welcome back, ${name}.` : 'FJ Ride Dispatch'} · {cityName} · {rangeLabel}
          </p>
        </div>
        {canRides && (
          <div className="page-actions">
            <div className="date-tabs">
              {DATE_PRESETS.map((x) => (
                <button
                  key={x.value}
                  type="button"
                  className={preset === x.value ? 'on' : ''}
                  onClick={() => applyPreset(x.value)}
                >
                  {x.label}
                </button>
              ))}
            </div>
            <input
              type="date"
              className="filter-select"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value)
                setPreset('')
              }}
            />
            <span className="date-range-sep">–</span>
            <input
              type="date"
              className="filter-select"
              value={to}
              onChange={(e) => {
                setTo(e.target.value)
                setPreset('')
              }}
            />
          </div>
        )}
      </div>

      {!canRides ? (
        <div className="placeholder-card">
          <span className="placeholder-badge">Dashboard</span>
          <h2>Welcome{name ? `, ${name}` : ''}</h2>
          <p>You don&rsquo;t have access to ride data, so there&rsquo;s nothing to summarise here yet.</p>
        </div>
      ) : (
        <>
          <div className="dash-hero">
            <Metric
              cls="dash-card-accent"
              icon={RouteIcon}
              value={num(s.total)}
              label="Total rides"
              trend={hasPrev ? pctChange(s.total, p.total) : null}
            />
            <Metric
              icon={Milestone}
              value={num(fmtKm(s.totalKm))}
              label="Total distance"
              trend={hasPrev ? pctChange(s.totalKm, p.totalKm) : null}
            />
            <Metric
              icon={Users2}
              value={num(s.crew)}
              label="Crew moved"
              trend={hasPrev ? pctChange(s.crew, p.crew) : null}
            />
            <Metric
              icon={Waypoints}
              value={num(`${deadheadPct.toFixed(1)}%`)}
              label="Deadhead ratio"
              sub="of total km run empty"
              trend={hasPrev ? pctChange(deadheadPct, prevDeadheadPct) : null}
            />
          </div>

          <div className="dash-cols">
            <section className="dash-section dash-col-main">
              <h2>Rides by block</h2>
              <div className="dash-grid">
                {BLOCKS.map(({ key, icon }) => (
                  <Metric
                    key={key}
                    cls={`blk-${key}`}
                    icon={icon}
                    value={num(s.blk[key].count)}
                    label={blockLabel(key)}
                    sub={num(fmtKm(s.blk[key].km))}
                  />
                ))}
              </div>
            </section>

            <section className="dash-section dash-col-side">
              <h2>Shift</h2>
              <div className="dash-stack">
                <Metric
                  cls="shift-day"
                  icon={Sun}
                  value={num(s.shift.day.count)}
                  label="Day trips"
                  sub={num(fmtKm(s.shift.day.km))}
                />
                <Metric
                  cls="shift-night"
                  icon={Moon}
                  value={num(s.shift.night.count)}
                  label="Night trips"
                  sub={num(fmtKm(s.shift.night.km))}
                />
              </div>
            </section>
          </div>

          {perDay.length > 1 && (
            <section className="dash-section">
              <h2>Rides per day</h2>
              <PerDayChart data={perDay} />
            </section>
          )}

          {cityId == null && byCity.length > 0 && (
            <section className="dash-section">
              <h2>By city</h2>
              <div className="dash-table">
                {byCity.map(([nm, v]) => (
                  <div className="dash-table-row" key={nm}>
                    <span>{nm}</span>
                    <span>{v.count} rides</span>
                    <span>{fmtKm(v.km)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="dash-section">
            <h2>Today · live</h2>
            {liveRows.length === 0 ? (
              <span className="dash-hint">No rides around now.</span>
            ) : (
              <div className="dash-live">
                {liveRows.map((r) => {
                  const st = liveStatus(r)
                  return (
                    <div className="dash-live-row" key={r.id}>
                      <span className="dash-live-time">
                        {r.start_at ? fmtTimeOnly12(r.start_at) : '—'}
                      </span>
                      <span className="dash-live-main">
                        <b>{r.ref_no}</b> · {blockLabel(r.block_type)} · {r.vehicle?.vehicle_no || 'no vehicle'}
                        {firstCrewName(r.ride_crew) ? ` · ${firstCrewName(r.ride_crew)}` : ''}
                      </span>
                      <span className={`dash-live-chip s-${st}`}>{liveLabel(r, st)}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function pctChange(cur, prev) {
  if (!prev) return null
  return Math.round(((cur - prev) / prev) * 100)
}

function Trend({ value, light }) {
  if (value == null) return null
  const up = value > 0
  const flat = value === 0
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span className={`dash-trend${light ? ' light' : up ? ' up' : flat ? '' : ' down'}`}>
      {!flat && <Icon size={12} strokeWidth={2.25} />}
      {value > 0 ? '+' : ''}
      {value}% vs prev
    </span>
  )
}

function Metric({ icon: Icon, value, label, sub, trend, cls }) {
  const accent = cls === 'dash-card-accent'
  return (
    <div className={`dash-card${cls ? ` ${cls}` : ''}`}>
      <div className="dash-ico">
        <Icon size={15} strokeWidth={1.75} />
      </div>
      <div className="dash-headline">
        <span className="dash-num">{value}</span>
        <span className="dash-name">{label}</span>
      </div>
      {sub && <span className="dash-sub">{sub}</span>}
      <Trend value={trend} light={accent} />
    </div>
  )
}

function PerDayChart({ data }) {
  const max = Math.max(1, ...data.map((d) => d.count))
  return (
    <div className="dash-chart">
      {data.map((d) => (
        <div
          className="dash-chart-col"
          key={d.date}
          title={`${fmtDate(d.date)} — ${d.count} ride(s)`}
        >
          <div className="dash-chart-bar" style={{ height: `${(d.count / max) * 100}%` }} />
        </div>
      ))}
    </div>
  )
}

// 'done' | 'now' | 'soon' (<60 min) | 'later'
function liveStatus(r) {
  const now = Date.now()
  const start = r.start_at ? new Date(r.start_at).getTime() : null
  const end = r.end_at ? new Date(r.end_at).getTime() : null
  if (end != null && now > end) return 'done'
  if (start != null && now >= start && (end == null || now <= end)) return 'now'
  if (start != null && start - now <= 60 * 60000) return 'soon'
  return 'later'
}

function liveLabel(r, st) {
  if (st === 'done') return 'done'
  if (st === 'now') return 'running'
  if (st === 'soon') {
    const mins = Math.max(1, Math.round((new Date(r.start_at).getTime() - Date.now()) / 60000))
    return `in ${mins} min`
  }
  return 'later'
}
