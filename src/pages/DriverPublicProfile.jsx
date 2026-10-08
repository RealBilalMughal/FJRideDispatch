import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { fmtDate } from '../lib/format'
import './DriverPublicProfile.css'

export default function DriverPublicProfile() {
  const { driverId } = useParams()
  const [driver, setDriver] = useState(null)
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [lightbox, setLightbox] = useState(null)

  useEffect(() => {
    if (!driverId) return
    const load = async () => {
      setLoading(true)
      const [{ data: drv }, { data: dd }] = await Promise.all([
        supabase
          .from('drivers')
          .select(
            'id, ref_no, name, contact, photo_path, cnic_no, account, designation, ' +
            'card_issue_date, card_valid_until, note, emergency_contact, ' +
            'manager_name, manager_designation, manager_email, manager_contact, ' +
            'city:cities(name), vendor:vendors(name)',
          )
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

  const storageUrl = (path) =>
    path ? supabase.storage.from('driver-docs').getPublicUrl(path).data.publicUrl : null

  if (loading) return <div className="dpp-shell"><div className="dpp-loading">Loading…</div></div>
  if (!driver) return <div className="dpp-shell"><div className="dpp-notfound">Driver not found.</div></div>

  const photoUrl = storageUrl(driver.photo_path)

  return (
    <div className="dpp-shell">
      {/* ── ID Card ── */}
      <div className="dpp-id-card">
        {/* Logo strip */}
        <div className="dpp-logo-strip">
          <img src="/logo.png" alt="BusCaro" className="dpp-logo" />
        </div>

        {/* Photo + identity */}
        <div className="dpp-body">
          <div className="dpp-photo-col">
            {photoUrl ? (
              <img src={photoUrl} alt={driver.name} className="dpp-photo" onClick={() => setLightbox(photoUrl)} />
            ) : (
              <div className="dpp-photo dpp-photo-empty">{driver.name?.charAt(0)?.toUpperCase() || '?'}</div>
            )}
          </div>

          <div className="dpp-fields-col">
            <h1 className="dpp-name">{driver.name}</h1>

            <div className="dpp-field-grid">
              <Field label="Driver ID" value={driver.ref_no} />
              {driver.cnic_no && <Field label="CNIC No" value={driver.cnic_no} />}
              {driver.account && <Field label="Account" value={driver.account} />}
              <Field label="Designation" value={driver.designation || 'Driver'} />
              {driver.city?.name && <Field label="City" value={driver.city.name} />}
              {driver.vendor?.name && <Field label="Vendor" value={driver.vendor.name} />}
            </div>
          </div>
        </div>

        {/* Dates + emergency row */}
        {(driver.card_issue_date || driver.card_valid_until || driver.emergency_contact) && (
          <div className="dpp-dates-row">
            {driver.card_issue_date && (
              <div className="dpp-date-chip">
                <span className="dpp-chip-label">Card Issue Date</span>
                <span className="dpp-chip-val">{fmtDate(driver.card_issue_date)}</span>
              </div>
            )}
            {driver.card_valid_until && (
              <div className="dpp-date-chip">
                <span className="dpp-chip-label">Card Valid Until</span>
                <span className="dpp-chip-val">{fmtDate(driver.card_valid_until)}</span>
              </div>
            )}
            {driver.emergency_contact && (
              <div className="dpp-date-chip">
                <span className="dpp-chip-label">Emergency Contact</span>
                <span className="dpp-chip-val">{driver.emergency_contact}</span>
              </div>
            )}
          </div>
        )}

        {/* Note */}
        {driver.note && (
          <div className="dpp-note-row">
            <span className="dpp-note-label">Note</span>
            <span className="dpp-note-text">{driver.note}</span>
          </div>
        )}

        {/* Account Manager */}
        {(driver.manager_name || driver.manager_email) && (
          <div className="dpp-manager">
            <div className="dpp-manager-head">Account Manager</div>
            <div className="dpp-manager-grid">
              {driver.manager_name && <Field label="Name" value={driver.manager_name} />}
              {driver.manager_designation && <Field label="Designation" value={driver.manager_designation} />}
              {driver.manager_email && <Field label="Email" value={driver.manager_email} />}
              {driver.manager_contact && <Field label="Contact No" value={driver.manager_contact} />}
            </div>
          </div>
        )}
      </div>

      {/* ── Uploaded Documents (below the card) ── */}
      {docs.length > 0 && (
        <div className="dpp-docs-section">
          <h2 className="dpp-docs-heading">Documents</h2>
          <div className="dpp-grid">
            {docs.map((d) => {
              const url = storageUrl(d.storage_path)
              const isPdf = d.storage_path?.toLowerCase().endsWith('.pdf')
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
        </div>
      )}

      {lightbox && (
        <div className="dpp-lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" onClick={(e) => e.stopPropagation()} />
          <button className="dpp-lightbox-close" onClick={() => setLightbox(null)}>✕</button>
        </div>
      )}
    </div>
  )
}

function Field({ label, value }) {
  return (
    <div className="dpp-field">
      <span className="dpp-field-label">{label}</span>
      <span className="dpp-field-value">{value ?? '—'}</span>
    </div>
  )
}
