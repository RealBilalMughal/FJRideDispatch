import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { MapPin, Mail, Phone, Globe } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fmtDate } from '../lib/format'
import './DriverPublicProfile.css'

// ── Company contact info (shown in page footer) ───────────────────────────
const COMPANY = {
  website: 'www.buscaro.com',
  websiteHref: 'https://www.buscaro.com',
  email: 'info@buscaro.com',
  phone: '+92 300 000 0000',
  phoneRaw: '+923000000000',
  address: 'Lahore, Pakistan',
}

export default function DriverPublicProfile() {
  const { driverId } = useParams()
  const [driver, setDriver] = useState(null)
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [lightbox, setLightbox] = useState(null)
  const [photoDims, setPhotoDims] = useState(null)

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
            'city:cities(name)',
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
  const hasAuth = driver.manager_name || driver.manager_email

  return (
    <div className="dpp-shell">
      {/* ── ID Card ── */}
      <div className="dpp-id-card">
        {/* Logo strip */}
        <div className="dpp-logo-strip">
          <img src="/logo.png" alt="BusCaro" className="dpp-logo" />
        </div>

        {/* Photo (centered) + name below it */}
        <div className="dpp-body">
          <div className="dpp-photo-wrap">
            {photoUrl ? (
              <img
                src={photoUrl}
                alt={driver.name}
                className="dpp-photo"
                onClick={() => setLightbox(photoUrl)}
                onLoad={(e) => setPhotoDims({ w: e.target.naturalWidth, h: e.target.naturalHeight })}
              />
            ) : (
              <div className="dpp-photo dpp-photo-empty">{driver.name?.charAt(0)?.toUpperCase() || '?'}</div>
            )}
            {photoDims && (
              <span className="dpp-photo-size">{photoDims.w}×{photoDims.h}</span>
            )}
          </div>

          <h1 className="dpp-name">{driver.name}</h1>

          <div className="dpp-field-grid">
            <Field label="Driver ID" value={driver.ref_no} />
            {driver.cnic_no && <Field label="CNIC" value={driver.cnic_no} />}
            {driver.account && <Field label="Account" value={driver.account} />}
            <Field label="Designation" value={driver.designation || 'Driver'} />
            {driver.city?.name && <Field label="City" value={driver.city.name} />}
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
                <span className="dpp-chip-label">Card Valid Date</span>
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

        {/* Authorized (Account Manager) */}
        {hasAuth && (
          <div className="dpp-manager">
            <div className="dpp-manager-head">Authorized</div>
            <div className="dpp-manager-grid">
              {driver.manager_name && <Field label="Name" value={driver.manager_name} />}
              {driver.manager_designation && <Field label="Designation" value={driver.manager_designation} />}
              {driver.manager_email && <Field label="Email" value={driver.manager_email} />}
              {driver.manager_contact && <Field label="Contact No" value={driver.manager_contact} />}
            </div>
          </div>
        )}

        {/* Note — always last inside the card */}
        {driver.note && (
          <div className="dpp-note-row">
            <span className="dpp-note-label">Note</span>
            <span className="dpp-note-text">{driver.note}</span>
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

      {/* ── Footer ── */}
      <footer className="dpp-footer">
        <a href={COMPANY.websiteHref} className="dpp-footer-item" target="_blank" rel="noopener noreferrer">
          <Globe size={14} /> {COMPANY.website}
        </a>
        <a href={`mailto:${COMPANY.email}`} className="dpp-footer-item">
          <Mail size={14} /> {COMPANY.email}
        </a>
        <div className="dpp-footer-contact">
          <a href={`tel:${COMPANY.phoneRaw}`} className="dpp-footer-item">
            <Phone size={14} /> {COMPANY.phone}
          </a>
          <a
            href={`https://wa.me/${COMPANY.phoneRaw.replace('+', '')}`}
            className="dpp-footer-wa"
            target="_blank"
            rel="noopener noreferrer"
            title="Chat on WhatsApp"
          >
            <WaIcon />
          </a>
        </div>
        <div className="dpp-footer-item dpp-footer-addr">
          <MapPin size={14} /> {COMPANY.address}
        </div>
      </footer>

      {/* ── Lightbox with watermark ── */}
      {lightbox && (
        <div className="dpp-lightbox" onClick={() => setLightbox(null)}>
          <div className="dpp-lightbox-inner" onClick={(e) => e.stopPropagation()}>
            <img src={lightbox} alt="" />
            <div className="dpp-lightbox-watermark">
              <img src="/logo.png" alt="BusCaro" />
            </div>
          </div>
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

function WaIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
      <path d="M12 0C5.373 0 0 5.373 0 12c0 2.134.558 4.133 1.528 5.87L0 24l6.336-1.508A11.952 11.952 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.95 0-3.773-.528-5.334-1.444l-.379-.224-3.933.937.966-3.823-.249-.394A9.943 9.943 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
    </svg>
  )
}
