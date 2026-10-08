import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import '../index.css'
import './DriverPublicProfile.css'

export default function DriverPublicProfile() {
  const { driverId } = useParams()
  const [driver, setDriver] = useState(null)
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [lightbox, setLightbox] = useState(null) // url | null

  useEffect(() => {
    if (!driverId) return
    const load = async () => {
      setLoading(true)
      const [{ data: drv }, { data: dd }] = await Promise.all([
        supabase
          .from('drivers')
          .select('id, name, city:cities(name), vendor:vendors(name)')
          .eq('id', driverId)
          .single(),
        supabase
          .from('driver_docs')
          .select('id, label, storage_path, uploaded_at')
          .eq('driver_id', driverId)
          .order('uploaded_at', { ascending: false }),
      ])
      setDriver(drv ?? null)
      setDocs(dd ?? [])
      setLoading(false)
    }
    load()
  }, [driverId])

  const publicUrl = (path) =>
    supabase.storage.from('driver-docs').getPublicUrl(path).data.publicUrl

  if (loading) {
    return (
      <div className="dpp-shell">
        <div className="dpp-loading">Loading…</div>
      </div>
    )
  }

  if (!driver) {
    return (
      <div className="dpp-shell">
        <div className="dpp-notfound">Driver not found.</div>
      </div>
    )
  }

  return (
    <div className="dpp-shell">
      <div className="dpp-card">
        <div className="dpp-header">
          <div className="dpp-avatar">{driver.name?.charAt(0)?.toUpperCase() || '?'}</div>
          <div className="dpp-info">
            <h1 className="dpp-name">{driver.name}</h1>
            <p className="dpp-meta">
              {driver.city?.name && <span>{driver.city.name}</span>}
              {driver.vendor?.name && <span> · {driver.vendor.name}</span>}
            </p>
          </div>
        </div>

        <div className="dpp-divider" />

        {docs.length === 0 ? (
          <p className="dpp-empty">No documents uploaded yet.</p>
        ) : (
          <div className="dpp-grid">
            {docs.map((d) => {
              const url = publicUrl(d.storage_path)
              const isPdf = d.storage_path.toLowerCase().endsWith('.pdf')
              return (
                <div key={d.id} className="dpp-doc" onClick={() => !isPdf && setLightbox(url)}>
                  {isPdf ? (
                    <a href={url} target="_blank" rel="noopener noreferrer" className="dpp-pdf-link">
                      <div className="dpp-pdf-thumb">PDF</div>
                      {d.label && <span className="dpp-label">{d.label}</span>}
                    </a>
                  ) : (
                    <>
                      <img src={url} alt={d.label || 'Document'} className="dpp-thumb" />
                      {d.label && <span className="dpp-label">{d.label}</span>}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {lightbox && (
        <div className="dpp-lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="Document" onClick={(e) => e.stopPropagation()} />
          <button className="dpp-lightbox-close" onClick={() => setLightbox(null)}>✕</button>
        </div>
      )}
    </div>
  )
}
