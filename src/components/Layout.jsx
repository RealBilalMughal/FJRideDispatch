import { Suspense, useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import CommandPalette from './CommandPalette'
import './layout.css'

function DeactivatedScreen({ onSignOut }) {
  return (
    <div className="notice-screen">
      <div className="card">
        <h2>Account deactivated</h2>
        <p>
          Your account is no longer active. Contact an administrator if you think this
          is a mistake.
        </p>
        <button type="button" className="btn btn-ghost btn-square" onClick={onSignOut}>
          Back to sign in
        </button>
      </div>
    </div>
  )
}

export default function Layout() {
  const { profile, loading, signOut } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const closeSidebar = () => setSidebarOpen(false)
  // Desktop icon-only mode - a separate concern from the mobile slide-in
  // drawer above (`sidebarOpen`). Remembered across sessions.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('sidebarCollapsed') === '1'
    } catch {
      return false
    }
  })
  const toggleCollapsed = () =>
    setCollapsed((v) => {
      const next = !v
      try {
        localStorage.setItem('sidebarCollapsed', next ? '1' : '0')
      } catch {
        /* private browsing, storage disabled, etc. - just don't persist */
      }
      return next
    })

  // Global Ctrl/Cmd+K quick search - works from any page; the Topbar also
  // carries its own visible "Search" trigger (left of the profile chip).
  const [paletteOpen, setPaletteOpen] = useState(false)
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(true)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  if (!loading && profile && profile.is_active === false) {
    return <DeactivatedScreen onSignOut={signOut} />
  }

  return (
    <div className={`app-shell${collapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar
        open={sidebarOpen}
        onNavigate={closeSidebar}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
      />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <div
        className={`sidebar-backdrop${sidebarOpen ? ' show' : ''}`}
        onClick={closeSidebar}
        aria-hidden="true"
      />
      <div className="app-main">
        <Topbar
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          onOpenSearch={() => setPaletteOpen(true)}
        />
        <main className="app-content">
          <Suspense fallback={<div style={{ color: 'var(--muted)', padding: 8 }}>Loading…</div>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  )
}
