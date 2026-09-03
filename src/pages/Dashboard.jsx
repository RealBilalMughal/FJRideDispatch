import { useAuth } from '../context/useAuth'

export default function Dashboard() {
  const { profile } = useAuth()
  const name = (profile?.full_name || '').split(' ')[0]

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">
            {name ? `Welcome back, ${name}.` : 'FJ Ride Dispatch console'}
          </p>
        </div>
      </div>

      <div className="placeholder-card">
        <span className="placeholder-badge">Setup</span>
        <h2>Console ready</h2>
        <p>
          Sign-in, roles, User Management and Role Access are wired up. Dispatch
          screens get built once the data model is in.
        </p>
      </div>
    </div>
  )
}
