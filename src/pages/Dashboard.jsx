import { useEffect, useMemo, useState } from 'react'
import {
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
import { presetRange } from '../lib/time'
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
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0)

export default function Dashboard() {
  const { profile, can } = useAuth()
  const { cityId, cityName, ready } = useCity()
  const canRides = can('rides', 'view')
  const name = (profile?.full_name || '').split(' ')[0]

  const initial = presetRange('month')
  const [preset, setPreset] = useState('month')
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [rides, setRides] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!ready || !canRides) return
    let alive = true
    setLoading(true)
    let q = supabase.from('rides').select('block_type, distance_km, shift, ride_crew(seq)')
    if (from) q = q.gte('ride_date', from)
    if (to) q = q.lte('ride_date', to)
    if (cityId != null) q = q.eq('city_id', cityId)
    q.then(({ data }) => {
      if (!alive) return
      setRides(data ?? [])
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [ready, canRides, from, to, cityId])

  const applyPreset = (p) => {
    const r = presetRange(p)
    setPreset(p)
    setFrom(r.from)
    setTo(r.to)
  }

  const s = useMemo(() => {
    const blk = Object.fromEntries(BLOCKS.map((b) => [b.key, { count: 0, km: 0 }]))
    const shift = { day: { count: 0, km: 0 }, night: { count: 0, km: 0 } }
    let crew = 0
    let totalKm = 0
    for (const r of rides) {
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
    return { total: rides.length, totalKm, crew, blk, shift }
  }, [rides])

  const num = (x) => (loading ? '…' : x)
  const rangeLabel =
    preset === 'all' ? 'all time' : preset ? DATE_PRESETS.find((p) => p.value === preset)?.label.toLowerCase() : 'custom range'

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
              {DATE_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className={preset === p.value ? 'on' : ''}
                  onClick={() => applyPreset(p.value)}
                >
                  {p.label}
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
            <HeroCard icon={RouteIcon} value={num(s.total)} label="Total rides" sub={`${num(s.total)} in ${rangeLabel}`} />
            <HeroCard icon={Milestone} value={num(fmtKm(s.totalKm))} label="Total distance" sub="road km, all blocks" />
            <HeroCard
              icon={Users2}
              value={num(s.crew)}
              label="Crew moved"
              sub="pickups + drop-offs only"
            />
          </div>

          <section className="dash-section">
            <h2>Rides by block</h2>
            <div className="dash-grid">
              {BLOCKS.map(({ key, icon: Icon }) => {
                const b = s.blk[key]
                return (
                  <div className={`dash-card blk-${key}`} key={key}>
                    <div className="dash-ico">
                      <Icon size={18} strokeWidth={1.75} />
                    </div>
                    <div className="dash-headline">
                      <span className="dash-num">{num(b.count)}</span>
                      <span className="dash-name">{blockLabel(key)}</span>
                    </div>
                    <span className="dash-sub">{num(fmtKm(b.km))}</span>
                    <div className="dash-bar">
                      <div style={{ width: `${loading ? 0 : pct(b.count, s.total)}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="dash-section">
            <h2>Day vs Night</h2>
            <div className="dash-grid dash-grid-2">
              <div className="dash-card shift-day">
                <div className="dash-ico">
                  <Sun size={18} strokeWidth={1.75} />
                </div>
                <div className="dash-headline">
                  <span className="dash-num">{num(s.shift.day.count)}</span>
                  <span className="dash-name">Day trips</span>
                </div>
                <span className="dash-sub">{num(fmtKm(s.shift.day.km))}</span>
                <div className="dash-bar">
                  <div style={{ width: `${loading ? 0 : pct(s.shift.day.count, s.total)}%` }} />
                </div>
              </div>
              <div className="dash-card shift-night">
                <div className="dash-ico">
                  <Moon size={18} strokeWidth={1.75} />
                </div>
                <div className="dash-headline">
                  <span className="dash-num">{num(s.shift.night.count)}</span>
                  <span className="dash-name">Night trips</span>
                </div>
                <span className="dash-sub">{num(fmtKm(s.shift.night.km))}</span>
                <div className="dash-bar">
                  <div style={{ width: `${loading ? 0 : pct(s.shift.night.count, s.total)}%` }} />
                </div>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function HeroCard({ icon: Icon, value, label, sub }) {
  return (
    <div className="dash-card dash-card-hero">
      <div className="dash-ico">
        <Icon size={19} strokeWidth={1.75} />
      </div>
      <div className="dash-headline">
        <span className="dash-num">{value}</span>
        <span className="dash-name">{label}</span>
      </div>
      {sub && <span className="dash-sub">{sub}</span>}
    </div>
  )
}
