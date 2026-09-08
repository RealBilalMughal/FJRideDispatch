import { useEffect } from 'react'
import { X } from 'lucide-react'
import './modal.css'

// Closes only via the X button or Esc - NOT a backdrop click, so a stray click
// while filling a form never loses the entered data.
export default function Modal({ open, onClose, title, children, width = 480, size }) {
  useEffect(() => {
    if (!open) return
    const onEsc = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onEsc)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onEsc)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className={`modal-backdrop${size ? ` modal-backdrop--${size}` : ''}`}>
      <div
        className={`modal-card${size ? ` modal-card--${size}` : ''}`}
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}
