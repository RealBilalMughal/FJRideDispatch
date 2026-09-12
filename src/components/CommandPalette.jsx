import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Car, Route as RouteIcon, Search, Users2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { useCity } from '../context/useCity'
import { blockLabel } from '../lib/rideRoute'
import { fmtDate } from '../lib/format'
import './command-palette.css'

const DEBOUNCE_MS = 200
const LIMIT = 6

/**
 * Global quick search (Ctrl/Cmd+K) - a ride/crew/vehicle by ref number,
 * flight, name or plate, from anywhere in the app. Picking a result
 * navigates to that entity's own list page with `?q=<term>` - each of
 * Rides/Crew/Vehicles seeds its own existing search box from that param
 * (Rides also switches its date filter to All, since "Today" would
 * otherwise hide a result from another day) rather than this component
 * knowing how to open a specific row itself.
 */
export default function CommandPalette({ open, onClose }) {
  const { can } = useAuth()
  const { cityId } = useCity()
  const navigate = useNavigate()
  const [term, setTerm] = useState('')
  const [rides, setRides] = useState([])
  const [crewList, setCrewList] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef(null)

  const canRides = can('rides', 'view')
  const canCrew = can('crew', 'view')
  const canVehicles = can('vehicles', 'view')

  useEffect(() => {
    if (!open) return
    setTerm('')
    setRides([])
    setCrewList([])
    setVehicles([])
    setActiveIdx(0)
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const q = term.trim()
    if (!q) {
      setRides([])
      setCrewList([])
      setVehicles([])
      return
    }
    let alive = true
    const t = setTimeout(async () => {
      const asNum = Number(q)
      const jobs = [
        canRides
          ? (() => {
              let query = supabase.from('rides').select('id, ref_no, flight_no, block_type, ride_date')
              query =
                Number.isFinite(asNum) && q !== ''
                  ? query.or(`ref_no.eq.${asNum},flight_no.ilike.%${q}%`)
                  : query.ilike('flight_no', `%${q}%`)
              if (cityId != null) query = query.eq('city_id', cityId)
              return query.order('ride_date', { ascending: false }).limit(LIMIT)
            })()
          : Promise.resolve({ data: [] }),
        canCrew
          ? (() => {
              let query = supabase.from('crew').select('id, ref_no, name').ilike('name', `%${q}%`).eq('is_active', true)
              if (cityId != null) query = query.eq('city_id', cityId)
              return query.limit(LIMIT)
            })()
          : Promise.resolve({ data: [] }),
        canVehicles
          ? (() => {
              let query = supabase
                .from('vehicles')
                .select('id, ref_no, vehicle_no')
                .ilike('vehicle_no', `%${q}%`)
                .eq('is_active', true)
              if (cityId != null) query = query.eq('city_id', cityId)
              return query.limit(LIMIT)
            })()
          : Promise.resolve({ data: [] }),
      ]
      const [rideRes, crewRes, vehicleRes] = await Promise.all(jobs)
      if (!alive) return
      setRides(rideRes.data ?? [])
      setCrewList(crewRes.data ?? [])
      setVehicles(vehicleRes.data ?? [])
      setActiveIdx(0)
    }, DEBOUNCE_MS)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [term, open, canRides, canCrew, canVehicles, cityId])

  const goTo = (path) => {
    navigate(path)
    onClose()
  }

  const groups = useMemo(
    () =>
      [
        {
          key: 'rides',
          label: 'Rides',
          icon: RouteIcon,
          items: rides.map((r) => ({
            id: r.id,
            title: `Ride ${r.ref_no}`,
            sub: `${blockLabel(r.block_type)}${r.flight_no ? ` · ${r.flight_no}` : ''} · ${fmtDate(r.ride_date)}`,
            go: () => goTo(`/rides?q=${r.ref_no}`),
          })),
        },
        {
          key: 'crew',
          label: 'Crew',
          icon: Users2,
          items: crewList.map((c) => ({
            id: c.id,
            title: c.name,
            sub: `Crew ${c.ref_no}`,
            go: () => goTo(`/crew?q=${encodeURIComponent(c.name)}`),
          })),
        },
        {
          key: 'vehicles',
          label: 'Vehicles',
          icon: Car,
          items: vehicles.map((v) => ({
            id: v.id,
            title: v.vehicle_no,
            sub: `Vehicle ${v.ref_no}`,
            go: () => goTo(`/vehicles?q=${encodeURIComponent(v.vehicle_no)}`),
          })),
        },
      ].filter((g) => g.items.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rides, crewList, vehicles],
  )

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups])

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, flat.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      flat[activeIdx]?.go()
    }
  }

  if (!open) return null

  let rowIndex = -1

  return (
    <div className="cmdk-backdrop" onMouseDown={onClose}>
      <div className="cmdk-box" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cmdk-input-row">
          <Search size={16} />
          <input
            ref={inputRef}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search rides, crew, vehicles…"
          />
          <kbd>Esc</kbd>
        </div>

        <div className="cmdk-results">
          {term.trim() === '' ? (
            <div className="cmdk-empty">Type to search across Rides, Crew and Vehicles</div>
          ) : flat.length === 0 ? (
            <div className="cmdk-empty">No matches</div>
          ) : (
            groups.map((g) => (
              <div className="cmdk-group" key={g.key}>
                <div className="cmdk-group-label">{g.label}</div>
                {g.items.map((item) => {
                  rowIndex += 1
                  const idx = rowIndex
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`cmdk-item${idx === activeIdx ? ' active' : ''}`}
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={item.go}
                    >
                      <g.icon size={15} />
                      <span className="cmdk-item-text">
                        <span className="cmdk-item-title">{item.title}</span>
                        <span className="cmdk-item-sub">{item.sub}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
