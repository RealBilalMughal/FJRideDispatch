import { Trash2, X } from 'lucide-react'
import './data.css'

// Shown when >=1 row is selected: count + a single destructive "Delete selected"
// action + a clear button.
export default function BulkDeleteBar({ count, onDelete, onClear, busy }) {
  if (!count) return null
  return (
    <div className="bulk-bar">
      <span className="bulk-count">{count} selected</span>
      <span className="spacer" />
      <button
        type="button"
        className="btn btn-sm btn-square btn-danger"
        onClick={onDelete}
        disabled={busy}
      >
        <Trash2 size={13} /> Delete selected
      </button>
      <button
        type="button"
        className="icon-btn"
        onClick={onClear}
        aria-label="Clear selection"
        style={{ border: 'none', background: 'none' }}
      >
        <X size={15} />
      </button>
    </div>
  )
}
