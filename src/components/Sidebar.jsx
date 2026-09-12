import { NavLink } from 'react-router-dom'
import { BarChart3, Calendar, Car, ClipboardList, IdCard, LayoutDashboard, Plane, Route, Satellite, Settings, ShieldCheck, Store, UserRound, Users2, UsersRound } from 'lucide-react'
import { useAuth } from '../context/useAuth'

// Grouped like the BlackDrivo / GraphicSpark admin left panel: labelled
// sections, no filled "pill" on the active item - accent text + a 3px left bar.
const NAV_SECTIONS = [
  {
    label: null,
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true }],
  },
  {
    label: 'Dispatch',
    items: [
      { to: '/rides', label: 'Ride', icon: Route, page: 'rides' },
      { to: '/ride-plan', label: 'Ride Plan', icon: ClipboardList, page: 'ride_plan' },
      { to: '/vehicle-board', label: 'Vehicle Board', icon: Calendar, page: 'rides' },
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

export default function Sidebar({ open, onNavigate }) {
  const { can, isSuperAdmin } = useAuth()

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
    <aside className={`sidebar${open ? ' open' : ''}`}>
      <div className="sidebar-brand">
        <span className="brand-mark">FJ</span>
        <span className="brand-name">Ride Dispatch</span>
      </div>

      <nav className="sidebar-nav">
        {NAV_SECTIONS.map((section, i) => {
          const items = section.items.filter(isVisible)
          if (items.length === 0) return null
          return (
            <div className="nav-section" key={section.label ?? `section-${i}`}>
              {section.label && <div className="nav-section-label">{section.label}</div>}
              {items.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end} onClick={onNavigate}>
                  <Icon size={17} strokeWidth={1.75} />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          )
        })}
      </nav>

      <div className="sidebar-foot">FJ Ride Dispatch</div>
    </aside>
  )
}
