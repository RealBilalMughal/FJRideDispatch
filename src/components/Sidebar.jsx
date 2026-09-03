import { NavLink } from 'react-router-dom'
import { LayoutDashboard } from 'lucide-react'

// Grouped left panel: labelled sections, no filled "pill" on the active item -
// accent text + a 3px left bar instead. Add sections as pages are built.
const NAV_SECTIONS = [
  {
    label: null,
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true }],
  },
]

export default function Sidebar({ open, onNavigate }) {
  return (
    <aside className={`sidebar${open ? ' open' : ''}`}>
      <div className="sidebar-brand">
        <span className="brand-mark">FJ</span>
        <span className="brand-name">Ride Dispatch</span>
      </div>

      <nav className="sidebar-nav">
        {NAV_SECTIONS.map((section, i) => (
          <div className="nav-section" key={section.label ?? `section-${i}`}>
            {section.label && <div className="nav-section-label">{section.label}</div>}
            {section.items.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} onClick={onNavigate}>
                <Icon size={17} strokeWidth={1.75} />
                <span>{label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-foot">FJ Ride Dispatch</div>
    </aside>
  )
}
