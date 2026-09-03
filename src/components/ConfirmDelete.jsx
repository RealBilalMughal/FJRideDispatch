import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import Modal from './Modal'

// Type-to-confirm delete. `word` defaults to DELETE.
export default function ConfirmDelete({
  open,
  title = 'Confirm delete',
  message,
  word = 'DELETE',
  busy = false,
  onConfirm,
  onClose,
}) {
  const [text, setText] = useState('')
  if (!open) return null

  const ok = text.trim() === word

  return (
    <Modal
      open
      onClose={() => {
        setText('')
        onClose()
      }}
      title={title}
      width={420}
    >
      <div className="modal-form">
        <div className="confirm-danger">
          <AlertTriangle size={16} />
          <span>{message}</span>
        </div>
        <div className="field">
          <label htmlFor="cd-input">
            Type <b>{word}</b> to confirm
          </label>
          <input
            id="cd-input"
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoComplete="off"
            autoFocus
          />
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-ghost btn-square"
            onClick={() => {
              setText('')
              onClose()
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger btn-square"
            disabled={!ok || busy}
            onClick={() => {
              onConfirm()
              setText('')
            }}
          >
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
