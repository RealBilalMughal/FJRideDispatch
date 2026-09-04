import { lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Login from './pages/Login'

// Route pages are code-split so heavy deps stay out of the initial bundle.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Rides = lazy(() => import('./pages/Rides'))
const VehicleBoard = lazy(() => import('./pages/VehicleBoard'))
const Crew = lazy(() => import('./pages/Crew'))
const Flights = lazy(() => import('./pages/Flights'))
const Vendors = lazy(() => import('./pages/Vendors'))
const Drivers = lazy(() => import('./pages/Drivers'))
const Vehicles = lazy(() => import('./pages/Vehicles'))
const Users = lazy(() => import('./pages/Users'))
const RoleAccess = lazy(() => import('./pages/RoleAccess'))
const Settings = lazy(() => import('./pages/Settings'))
const Profile = lazy(() => import('./pages/Profile'))

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="rides" element={<Rides />} />
          <Route path="vehicle-board" element={<VehicleBoard />} />
          <Route path="crew" element={<Crew />} />
          <Route path="flights" element={<Flights />} />
          <Route path="vendors" element={<Vendors />} />
          <Route path="drivers" element={<Drivers />} />
          <Route path="vehicles" element={<Vehicles />} />
          <Route path="users" element={<Users />} />
          <Route path="role-access" element={<RoleAccess />} />
          <Route path="settings" element={<Settings />} />
          <Route path="profile" element={<Profile />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
