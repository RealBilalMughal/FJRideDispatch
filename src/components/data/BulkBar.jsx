import { X } from 'lucide-react'
import './data.css'

// actions: [{ value, label }]
export default function BulkBar({ count, actions, value, onValue, onApply, onClear, busy }) {
  if (count === 0) return null
  return (
    <div className="bulk-bar">
      <span className="bulk-count">{count} selected</span>
      <span className="spacer" />
      <select className="filter-select" value={value} onChange={(e) => onValue(e.target.value)}>
        <option value="">Bulk action&hellip;</option>
        {actions.map((a) => (
          <option key={a.value} value={a.value}>
            {a.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn btn-sm btn-square"
        onClick={onApply}
        disabled={!value || busy}
      >
        {busy ? 'Working…' : 'Apply'}
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
