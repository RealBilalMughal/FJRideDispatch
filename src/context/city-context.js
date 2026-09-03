import { createContext } from 'react'

// Kept separate so the provider module only exports a component (Fast Refresh).
export const CityContext = createContext(null)
