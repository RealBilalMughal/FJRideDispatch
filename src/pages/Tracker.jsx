import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Search, Shield } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { useCity } from '../context/useCity'
import { fetchFleetTracker } from '../lib/tracker'
import '../components/stop-map.css'
import './Tracker.css'

const POLL_MS = 15000
const STALE_MS = 60 * 60 * 1000
const STATUS_LABEL = { green: 'Moving', red: 'Stopped', blue: 'Offline', yellow: 'Engine on' }
const STATUS_COLOR = { green: '#1e874b', red: '#c0392b', blue: '#0e7490', yellow: '#b7791f' }
const colorOf = (s) => STATUS_COLOR[s] || '#c9ccd1'
const plate = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, '')

export default function Tracker() {
  const { can } = useAuth()
  const { cityId, cityName, allowedCities } = useCity()
  const canView = can('rides', 'view')

  const trackerCities = useMemo(() => {
    const cs = allowedCities.filter((c) => c.tracker_url)
    return cityId == null ? cs : cs.filter((c) => c.id === cityId)
  }, [allowedCities, cityId])
  const links = useMemo(
    () => [...new Set(trackerCities.map((c) => c.tracker_url))],
    [trackerCities],
  )

  // full vehicle roster from our own DB - so the list never flickers
  const [vehicles, setVehicles] = useState([])
  useEffect(() => {
    if (!canView) return
    let alive = true
    let q = supabase.from('vehicles').select('id, ref_no, vehicle_no, tracker_url, is_active, city_id')
    if (cityId != null) q = q.eq('city_id', cityId)
    q.then(({ data }) => {
      if (alive) setVehicles((data ?? []).filter((v) => v.is_active))
    })
    return () => {
      alive = false
    }
  }, [canView, cityId])

  // live status/speed for the list dots - AI Track's /items only returns
  // recently-pinged vehicles, so accumulate by plate; drop after STALE_MS.
  const [fixes, setFixes] = useState({})
  useEffect(() => {
    setFixes({})
    if (!canView || links.length === 0) return
    let alive = true
    const poll = async () => {
      const fresh = (await Promise.all(links.map(fetchFleetTracker))).flat()
      if (!alive) return
      const now = Date.now()
      setFixes((prev) => {
        const next = { ...prev }
        for (const it of fresh) next[plate(it.name)] = { ...it, seenAt: now }
        for (const k of Object.keys(next)) if (now - next[k].seenAt > STALE_MS) delete next[k]
        return next
      })
    }
    poll()
    const id = setInterval(poll, POLL_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, links])

  const [q, setQ] = useState('')
  const [sel, setSel] = useState(null) // selected vehicle row, or null

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return vehicles
      .map((v) => ({ v, fix: fixes[plate(v.vehicle_no)] || null }))
      .filter(({ v }) => !s || v.vehicle_no.toLowerCase().includes(s))
      .sort((a, b) => {
        if (!!a.fix !== !!b.fix) return a.fix ? -1 : 1
        return a.v.vehicle_no.localeCompare(b.v.vehicle_no)
      })
  }, [vehicles, fixes, q])

  if (!canView) {
    return (
      <div className="page">
        <div className="card placeholder-card">
          <Shield size={28} color="var(--muted)" />
          <h2>No access</h2>
          <p>You don&rsquo;t have permission to view the tracker.</p>
        </div>
      </div>
    )
  }

  const liveCount = rows.filter((r) => r.fix).length
  const single = trackerCities.length === 1

  return (
    <div className="page tk-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Tracker</h1>
          <p className="page-subtitle">
            {cityName} · {liveCount} of {vehicles.length} vehicle{vehicles.length === 1 ? '' : 's'} live
          </p>
        </div>
      </div>

      {links.length === 0 ? (
        <div className="card placeholder-card">
          <Shield size={28} color="var(--muted)" />
          <h2>No tracker link set</h2>
          <p>Add {cityId == null ? 'a' : "this city's"} sharing link at Settings → Live Tracker.</p>
        </div>
      ) : (
        <div className="tk-layout">
          <aside className="tk-list">
            <div className="tk-list-head">Vehicles</div>
            <div className="tk-search">
              <Search size={13} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search vehicle…"
                autoComplete="off"
              />
            </div>
            <div className="tk-list-scroll">
              {rows.length === 0 ? (
                <span className="tk-empty">
                  {vehicles.length === 0 ? 'No vehicles in this city.' : 'No match.'}
                </span>
              ) : (
                rows.map(({ v, fix }) => (
                  <button
                    key={v.id}
                    type="button"
                    className={`tk-list-item${sel?.v.id === v.id ? ' on' : ''}`}
                    onClick={() => setSel({ v, fix })}
                    title={v.tracker_url ? 'Focus this vehicle on the map' : 'No per-vehicle link (add one on Vehicles)'}
                  >
                    <span className="tk-dot" style={{ background: fix ? colorOf(fix.status) : '#c9ccd1' }} />
                    <span className="tk-item-main">
                      <span className="tk-item-name">{v.vehicle_no}</span>
                      <span className="tk-item-sub">
                        {fix ? `${STATUS_LABEL[fix.status] || '—'} · ${Math.round(fix.speed)} kph` : 'No signal'}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </aside>

          <div className="tk-view">
            {sel?.v.tracker_url ? (
              <>
                <div className="tk-view-bar">
                  <button type="button" className="tk-back" onClick={() => setSel(null)}>
                    <ArrowLeft size={13} /> All vehicles
                  </button>
                  <span className="tk-view-name">{sel.v.vehicle_no}</span>
                </div>
                <div className="stop-map tk-map">
                  <iframe
                    key={sel.v.id}
                    src={sel.v.tracker_url}
                    title={`Tracker — ${sel.v.vehicle_no}`}
                    style={{ width: '100%', height: '100%', border: 0 }}
                  />
                </div>
              </>
            ) : (
              <>
                {sel && !sel.v.tracker_url && (
                  <div className="tk-view-bar">
                    <span className="tk-hint">
                      {sel.v.vehicle_no} has no per-vehicle tracker link — add one on the Vehicles page to
                      focus it here.
                    </span>
                    <button type="button" className="tk-back" onClick={() => setSel(null)}>
                      Dismiss
                    </button>
                  </div>
                )}
                {trackerCities.map((c) => (
                  <div key={c.id} className="tk-frame-wrap">
                    {!single && <div className="tk-frame-label">{c.name}</div>}
                    <div className={`stop-map tk-map${single ? '' : ' tk-map-split'}`}>
                      <iframe
                        src={c.tracker_url}
                        title={`Tracker — ${c.name}`}
                        style={{ width: '100%', height: '100%', border: 0 }}
                      />
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
