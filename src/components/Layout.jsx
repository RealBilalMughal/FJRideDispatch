import { Suspense, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
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

  if (!loading && profile && profile.is_active === false) {
    return <DeactivatedScreen onSignOut={signOut} />
  }

  return (
    <div className="app-shell">
      <Sidebar open={sidebarOpen} onNavigate={closeSidebar} />
      <div
        className={`sidebar-backdrop${sidebarOpen ? ' show' : ''}`}
        onClick={closeSidebar}
        aria-hidden="true"
      />
      <div className="app-main">
        <Topbar onToggleSidebar={() => setSidebarOpen((v) => !v)} />
        <main className="app-content">
          <Suspense fallback={<div style={{ color: 'var(--muted)', padding: 8 }}>Loading…</div>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  )
}
