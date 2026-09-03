import { MapPin } from 'lucide-react'
import { useCity } from '../context/useCity'
import './city-filter.css'

// The global city control in the topbar. Locked (plain label) when the user can
// see only one city; a dropdown of "All + their cities" otherwise.
export default function CityFilter() {
  const { ready, allowedCities, locked, city, setCity, cityName } = useCity()

  if (!ready || allowedCities.length === 0) return null

  if (locked) {
    return (
      <span className="city-filter locked" title="Your access is limited to this city">
        <MapPin size={14} />
        {cityName}
      </span>
    )
  }

  return (
    <label className="city-filter">
      <MapPin size={14} />
      <select value={city} onChange={(e) => setCity(e.target.value)} aria-label="City filter">
        <option value="all">All cities</option>
        {allowedCities.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  )
}
