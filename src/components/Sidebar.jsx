import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  BarChart3,
  Calendar,
  Car,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  IdCard,
  LayoutDashboard,
  Plane,
  Route,
  Satellite,
  Search,
  Settings,
  ShieldCheck,
  Store,
  UserRound,
  Users2,
  UsersRound,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { useCity } from '../context/useCity'
import { pkToday } from '../lib/time'

// Grouped like the BlackDrivo / GraphicSpark admin left panel: labelled
// sections, no filled "pill" on the active item - accent text + a 3px left bar.
// `badge` names a live count key (see useSidebarBadges below) - shown as a
// small pill after the label so a dispatcher can see where today needs
// attention without opening the page.
const NAV_SECTIONS = [
  {
    label: null,
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true }],
  },
  {
    label: 'Dispatch',
    items: [
      { to: '/rides', label: 'Ride', icon: Route, page: 'rides' },
      { to: '/ride-plan', label: 'Ride Plan', icon: ClipboardList, page: 'ride_plan', badge: 'planPending' },
      { to: '/vehicle-board', label: 'Vehicle Board', icon: Calendar, page: 'rides', badge: 'unassigned' },
      { to: '/tracker', label: 'Tracker', icon: Satellite, page: 'rides' },
      { to: '/reports', label: 'Reports', icon: BarChart3, page: ['rides', 'ride_plan'] },
    ],
  },
  {
    label: 'Roster',
    items: [
      { to: '/crew', label: 'Crew', icon: Users2, page: 'crew' },
      { to: '/flights', label: 'Flights', icon: Plane, page: 'flights' },
    ],
  },
  {
    label: 'Fleet',
    items: [
      { to: '/vendors', label: 'Vendors', icon: Store, page: 'vendors' },
      { to: '/drivers', label: 'Drivers', icon: UserRound, page: 'drivers' },
      { to: '/vehicles', label: 'Vehicles', icon: Car, page: 'vehicles' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { to: '/users', label: 'User Management', icon: UsersRound, page: 'users' },
      { to: '/role-access', label: 'Role Access', icon: ShieldCheck, page: 'roles' },
      { to: '/settings', label: 'Settings', icon: Settings, superAdminOnly: true },
    ],
  },
  {
    label: 'Account',
    items: [{ to: '/profile', label: 'Profile', icon: IdCard }],
  },
]

const BADGE_REFRESH_MS = 60000

// Today's "needs attention" counts for the sidebar's own badges - fetched
// once here (the sidebar is mounted for the whole app session) rather than
// duplicated per-page, and refreshed on a timer + whenever the city filter
// changes. `count: 'exact', head: true` asks Postgres for just the row
// count, no rows returned - cheap enough to poll.
function useSidebarBadges({ canPlan, canRides, cityId }) {
  const [counts, setCounts] = useState({})

  useEffect(() => {
    if (!canPlan && !canRides) return
    let alive = true
    const today = pkToday()

    const load = async () => {
      const next = {}
      if (canPlan) {
        let q = supabase
          .from('ride_plan_rows')
          .select('id', { count: 'exact', head: true })
          .eq('plan_date', today)
          .eq('status', 'pending')
        if (cityId != null) q = q.eq('city_id', cityId)
        const { count } = await q
        next.planPending = count ?? 0
      }
      if (canRides) {
        let q = supabase
          .from('rides')
          .select('id', { count: 'exact', head: true })
          .eq('ride_date', today)
          .is('vehicle_id', null)
          .eq('is_adhoc_vehicle', false)
          .neq('status', 'cancelled')
        if (cityId != null) q = q.eq('city_id', cityId)
        const { count } = await q
        next.unassigned = count ?? 0
      }
      if (alive) setCounts(next)
    }

    load()
    const t = setInterval(load, BADGE_REFRESH_MS)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [canPlan, canRides, cityId])

  return counts
}

export default function Sidebar({ open, onNavigate, collapsed, onToggleCollapsed, onOpenSearch }) {
  const { can, isSuperAdmin } = useAuth()
  const { cityId } = useCity()
  const badges = useSidebarBadges({
    canPlan: can('ride_plan', 'view'),
    canRides: can('rides', 'view'),
    cityId,
  })

  const isVisible = (item) => {
    if (item.superAdminOnly) return isSuperAdmin
    if (item.page === 'roles') return isSuperAdmin || can('roles', 'view')
    // Reports reuses Rides/Ride Plan's own permissions rather than a page of
    // its own (same reasoning as Vehicle Board/Tracker reusing 'rides') -
    // visible with EITHER, since it serves both a ride-side and a plan-side
    // audience.
    if (Array.isArray(item.page)) return item.page.some((p) => can(p, 'view'))
    if (item.page) return can(item.page, 'view')
    return true
  }

  return (
    <aside className={`sidebar${open ? ' open' : ''}${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-brand">
        {!collapsed && <img src="/logo.png" alt="BusCaro" className="sidebar-logo" />}
        <button
          type="button"
          className="icon-btn sidebar-collapse-btn"
          onClick={onToggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        </button>
      </div>

      <button
        type="button"
        className="sidebar-search-btn"
        onClick={onOpenSearch}
        title="Search rides, crew, vehicles"
      >
        <Search size={15} />
        <span>Search…</span>
        <kbd>Ctrl K</kbd>
      </button>

      <nav className="sidebar-nav">
        {NAV_SECTIONS.map((section, i) => {
          const items = section.items.filter(isVisible)
          if (items.length === 0) return null
          return (
            <div className="nav-section" key={section.label ?? `section-${i}`}>
              {section.label && <div className="nav-section-label">{section.label}</div>}
              {items.map(({ to, label, icon: Icon, end, badge }) => {
                const count = badge ? badges[badge] : null
                return (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    onClick={onNavigate}
                    title={count ? `${label} · ${count}` : label}
                  >
                    <Icon size={17} strokeWidth={1.75} />
                    <span>{label}</span>
                    {Boolean(count) && <span className="nav-badge">{count}</span>}
                  </NavLink>
                )
              })}
            </div>
          )
        })}
      </nav>

      {!collapsed && <div className="sidebar-foot">FJ Ride Dispatch</div>}
    </aside>
  )
}
