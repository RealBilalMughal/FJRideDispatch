import { useMemo } from 'react'
import { Shield } from 'lucide-react'
import { useAuth } from '../context/useAuth'
import { useCity } from '../context/useCity'
import '../components/stop-map.css'
import './Tracker.css'

// Full-page live GPS tracking - each city's own sharing link (Settings ->
// Live Tracker, cities.tracker_url), embedded as big as the viewport
// reasonably allows. One city selected -> that city's link; All -> every
// allowed city that has one, stacked with a name label.
export default function Tracker() {
  const { can } = useAuth()
  const { cityId, cityName, allowedCities } = useCity()
  const canView = can('rides', 'view')

  const trackerCities = useMemo(() => {
    const withLink = allowedCities.filter((c) => c.tracker_url)
    return cityId == null ? withLink : withLink.filter((c) => c.id === cityId)
  }, [allowedCities, cityId])

  if (!canView) {
    return (
      <div className="page">
        <div className="card placeholder-card">
          <Shield size={28} color="var(--muted)" />
          <h2>No access</h2>
          <p>You don&rsquo;t have permission to view the tracker.</p>
        </div>
      </div>
    )
  }

  const single = trackerCities.length === 1

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Tracker</h1>
          <p className="page-subtitle">{cityName} · live vehicle tracking</p>
        </div>
      </div>

      {trackerCities.length === 0 ? (
        <div className="card placeholder-card">
          <Shield size={28} color="var(--muted)" />
          <h2>No tracker link set</h2>
          <p>Add {cityId == null ? 'a' : "this city's"} sharing link at Settings → Live Tracker.</p>
        </div>
      ) : (
        <div className="tk-list">
          {trackerCities.map((c) => (
            <div key={c.id}>
              {!single && <div className="tk-label">{c.name}</div>}
              <div className={`stop-map tk-frame${single ? '' : ' tk-frame-split'}`}>
                <iframe
                  src={c.tracker_url}
                  title={`Live Tracker - ${c.name}`}
                  style={{ width: '100%', height: '100%', border: 0 }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
