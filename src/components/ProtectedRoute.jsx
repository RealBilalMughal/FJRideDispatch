import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import FullLoader from './FullLoader'

const DISPATCHER_ROLES = ['super_admin', 'admin', 'agent', 'ops']

export default function ProtectedRoute() {
  const { loading, isAuthenticated, roles } = useAuth()
  const location = useLocation()

  if (loading) return <FullLoader />
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  // Driver-only accounts → redirect to the driver odometer page
  const isDriver = roles.includes('driver') && !roles.some(r => DISPATCHER_ROLES.includes(r))
  if (isDriver && location.pathname !== '/driver') {
    return <Navigate to="/driver" replace />
  }

  return <Outlet />
}
