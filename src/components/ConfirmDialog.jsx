import Modal from './Modal'

// A plain in-app confirm popup (replaces window.confirm). Closes via Cancel / X /
// Esc like every other Modal; the primary button runs `onConfirm`.
export default function ConfirmDialog({
  open,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  busyLabel = 'Working…',
  tone = 'accent', // 'accent' | 'danger'
  busy = false,
  onConfirm,
  onClose,
}) {
  if (!open) return null
  return (
    <Modal open onClose={onClose} title={title} width={400}>
      <div className="modal-form">
        {message && <p className="confirm-msg">{message}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn btn-square${tone === 'danger' ? ' btn-danger' : ''}`}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}
