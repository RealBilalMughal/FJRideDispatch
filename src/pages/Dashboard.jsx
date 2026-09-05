import { useEffect, useMemo, useState } from 'react'
import { MapPin, Moon, Route as RouteIcon, Sun, Users2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { useCity } from '../context/useCity'
import { presetRange } from '../lib/time'
import { blockLabel, displayCrewCount } from '../lib/rideRoute'
import StatCards from '../components/data/StatCards'
import './Dashboard.css'

const DATE_PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'all', label: 'All' },
]
const BLOCKS = ['pickup', 'dropoff', 'deadhead', 'return_leg']
const km = (r) => Number(r.distance_km) || 0
const fmtKm = (n) => `${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} km`

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
    const blk = Object.fromEntries(BLOCKS.map((b) => [b, { count: 0, km: 0 }]))
    let dayCount = 0
    let dayKm = 0
    let nightCount = 0
    let nightKm = 0
    let crew = 0
    let totalKm = 0
    for (const r of rides) {
      totalKm += km(r)
      crew += displayCrewCount(r.ride_crew, r.block_type)
      if (blk[r.block_type]) {
        blk[r.block_type].count += 1
        blk[r.block_type].km += km(r)
      }
      if (r.shift === 'day') {
        dayCount += 1
        dayKm += km(r)
      } else if (r.shift === 'night') {
        nightCount += 1
        nightKm += km(r)
      }
    }
    return { total: rides.length, totalKm, crew, blk, dayCount, dayKm, nightCount, nightKm }
  }, [rides])

  const v = (x) => (loading ? '…' : x)

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">
            {name ? `Welcome back, ${name}.` : 'FJ Ride Dispatch'} · {cityName}
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
          <StatCards
            items={[
              { key: 'total', label: 'Total rides', value: v(s.total), icon: RouteIcon },
              { key: 'km', label: 'Total distance', value: v(fmtKm(s.totalKm)), icon: MapPin },
              { key: 'crew', label: 'Crew moved', value: v(s.crew), icon: Users2 },
            ]}
          />

          <section className="dash-section">
            <h2>By block</h2>
            <div className="dash-grid">
              {BLOCKS.map((b) => (
                <div className="dash-tile" key={b}>
                  <span className="dash-tile-label">{blockLabel(b)}</span>
                  <span className="dash-tile-value">{v(s.blk[b].count)}</span>
                  <span className="dash-tile-sub">{v(fmtKm(s.blk[b].km))}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="dash-section">
            <h2>By shift</h2>
            <div className="dash-grid">
              <div className="dash-tile">
                <span className="dash-tile-label">
                  <Sun size={13} /> Day trips
                </span>
                <span className="dash-tile-value">{v(s.dayCount)}</span>
                <span className="dash-tile-sub">{v(fmtKm(s.dayKm))}</span>
              </div>
              <div className="dash-tile">
                <span className="dash-tile-label">
                  <Moon size={13} /> Night trips
                </span>
                <span className="dash-tile-value">{v(s.nightCount)}</span>
                <span className="dash-tile-sub">{v(fmtKm(s.nightKm))}</span>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
