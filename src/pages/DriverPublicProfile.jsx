import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { MapPin, Mail, Phone, Globe } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fmtDate } from '../lib/format'
import './DriverPublicProfile.css'

export default function DriverPublicProfile() {
  const { refNo } = useParams()
  const [driver, setDriver] = useState(null)
  const [docs, setDocs] = useState([])
  const [info, setInfo] = useState(null) // buscaro_info row
  const [loading, setLoading] = useState(true)
  const [lightbox, setLightbox] = useState(null)
  const [photoDims, setPhotoDims] = useState(null)

  useEffect(() => {
    if (!refNo) return
    const load = async () => {
      setLoading(true)
      const [{ data: drv }, { data: bi }] = await Promise.all([
        supabase
          .from('drivers')
          .select(
            'id, ref_no, name, contact, photo_path, cnic_no, account, designation, ' +
            'card_issue_date, card_valid_until, note, emergency_contact, employee_id, qr_redirect_url, ' +
            'manager_id, qr_active, qr_inactive_reason, ' +
            'city:cities(name), manager:account_managers(id, name, designation, email, contact)',
          )
          .eq('ref_no', refNo)
          .single(),
        supabase
          .from('buscaro_info')
          .select('website, email, contact, address, theme_color, logo_path, watermark_path')
          .eq('id', 1)
          .single(),
      ])
      let dd = []
      if (drv?.id) {
        const { data } = await supabase
          .from('driver_docs')
          .select('id, label, storage_path, uploaded_at')
          .eq('driver_id', drv.id)
          .order('uploaded_at', { ascending: false })
        dd = data ?? []
      }
      setDriver(drv ?? null)
      setDocs(dd)
      setInfo(bi ?? {})
      // Redirect if a custom destination is set (QR code itself never changes)
      if (drv?.qr_active !== false && drv?.qr_redirect_url) {
        window.location.replace(drv.qr_redirect_url)
        return
      }
      // Log scan only for active profiles (inactive screen shows instead of profile)
      if (drv?.id && drv?.qr_active !== false) {
        const ua = navigator.userAgent || null
        let ip = null
        try {
          const r = await fetch('https://api.ipify.org?format=json')
          if (r.ok) ip = (await r.json()).ip ?? null
        } catch { /* best-effort */ }
        supabase.from('driver_qr_scans').insert({ driver_id: drv.id, user_agent: ua, ip_address: ip })
      }
      setLoading(false)
    }
    load()
  }, [refNo])

  const storageUrl = (path, bucket = 'driver-docs') =>
    path ? supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl : null

  if (loading) return <div className="dpp-shell"><div className="dpp-loading">Loading…</div></div>
  if (!driver) return <div className="dpp-shell"><div className="dpp-notfound">Driver not found.</div></div>

  const accent      = info?.theme_color || '#fe8c03'
  const logoUrl     = storageUrl(info?.logo_path, 'company-assets') || '/logo.png'

  // Inactive screen — shown before the full profile render
  if (driver.qr_active === false) {
    return (
      <div className="dpp-shell" style={{ '--dpp-accent': accent }}>
        <div className="dpp-id-card">
          <div className="dpp-logo-strip">
            <img src={logoUrl} alt="BusCaro" className="dpp-logo" />
          </div>
          <div style={{ padding: '40px 28px 36px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#fee2e2', display: 'grid', placeItems: 'center' }}>
              <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
            <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 18, fontWeight: 700, color: '#2D2C2B', margin: 0 }}>
              This profile has been deactivated
            </h2>
            {driver.qr_inactive_reason && (
              <p style={{ fontSize: 13, color: '#727272', margin: 0, maxWidth: 320, lineHeight: 1.6 }}>
                {driver.qr_inactive_reason}
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }
  const wmUrl       = storageUrl(info?.watermark_path, 'company-assets')
  const photoUrl    = storageUrl(driver.photo_path)
  const hasAuth     = driver.manager?.name || driver.manager?.email
  const phoneRaw    = info?.contact?.replace(/[\s\-()]/g, '') || ''

  // Tiling watermark style — applied as a CSS var so all overlay divs pick it up
  const wmStyle = wmUrl
    ? { '--dpp-wm': `url(${wmUrl})` }
    : {}

  return (
    <div className="dpp-shell" style={{ '--dpp-accent': accent, ...wmStyle }}>
      {/* ── ID Card ── */}
      <div className="dpp-id-card">
        {/* Logo strip */}
        <div className="dpp-logo-strip">
          <img src={logoUrl} alt="BusCaro" className="dpp-logo" />
        </div>

        {/* Photo (centered) + name below it */}
        <div className="dpp-body">
          <div className="dpp-photo-wrap">
            {photoUrl ? (
              <>
                <img
                  src={photoUrl}
                  alt={driver.name}
                  className="dpp-photo"
                  onClick={() => setLightbox(photoUrl)}
                  onLoad={(e) => setPhotoDims({ w: e.target.naturalWidth, h: e.target.naturalHeight })}
                />
                {/* Tiling watermark over the card photo */}
                {wmUrl && <div className="dpp-photo-wm" />}
              </>
            ) : (
              <div className="dpp-photo dpp-photo-empty">{driver.name?.charAt(0)?.toUpperCase() || '?'}</div>
            )}
            {photoDims && (
              <span className="dpp-photo-size">{photoDims.w}×{photoDims.h}</span>
            )}
          </div>

          <h1 className="dpp-name">{driver.name}</h1>

          <div className="dpp-field-grid">
            <Field label={driver.employee_id ? 'Employee ID' : 'Driver ID'} value={driver.employee_id || driver.ref_no} />
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
              {driver.manager?.name && <Field label="Name" value={driver.manager.name} />}
              {driver.manager?.designation && <Field label="Designation" value={driver.manager.designation} />}
              {driver.manager?.email && <Field label="Email" value={driver.manager.email} />}
              {driver.manager?.contact && <Field label="Contact No" value={driver.manager.contact} />}
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
                    <div className="dpp-thumb-wrap">
                      <img src={url} alt={d.label || 'Document'} className="dpp-thumb" />
                      {/* Tiling watermark over doc thumbnails */}
                      {wmUrl && <div className="dpp-thumb-wm" />}
                      {d.label && <span className="dpp-label">{d.label}</span>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      {(info?.website || info?.email || info?.contact || info?.address) && (
        <footer className="dpp-footer">
          {info.website && (
            <a href={`https://${info.website.replace(/^https?:\/\//, '')}`} className="dpp-footer-item" target="_blank" rel="noopener noreferrer">
              <Globe size={14} /> {info.website}
            </a>
          )}
          {info.email && (
            <a href={`mailto:${info.email}`} className="dpp-footer-item">
              <Mail size={14} /> {info.email}
            </a>
          )}
          {info.contact && (
            <div className="dpp-footer-contact">
              <a href={`tel:${phoneRaw}`} className="dpp-footer-item">
                <Phone size={14} /> {info.contact}
              </a>
              {phoneRaw && (
                <a
                  href={`https://wa.me/${phoneRaw.replace('+', '')}`}
                  className="dpp-footer-wa"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Chat on WhatsApp"
                >
                  <WaIcon />
                </a>
              )}
            </div>
          )}
          {info.address && (
            <div className="dpp-footer-item dpp-footer-addr">
              <MapPin size={14} /> {info.address}
            </div>
          )}
        </footer>
      )}

      {/* ── Lightbox with tiling watermark ── */}
      {lightbox && (
        <div className="dpp-lightbox" onClick={() => setLightbox(null)}>
          <div className="dpp-lightbox-inner" onClick={(e) => e.stopPropagation()}>
            <img src={lightbox} alt="" />
            {wmUrl && <div className="dpp-lightbox-wm" />}
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
