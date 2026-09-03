import { createContext } from 'react'

// Kept in its own file so the provider module only exports a component
// (keeps React Fast Refresh happy).
export const AuthContext = createContext(null)
