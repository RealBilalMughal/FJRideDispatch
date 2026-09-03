import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import './search-select.css'

// options: [{ value, label, sub? }]
export default function SearchSelect({ value, onChange, options, placeholder = 'Select…', disabled }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const boxRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const selected = options.find((o) => o.value === value)
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return options.slice(0, 50)
    return options
      .filter((o) => `${o.label} ${o.sub ?? ''}`.toLowerCase().includes(s))
      .slice(0, 50)
  }, [options, q])

  return (
    <div className={`ss${disabled ? ' disabled' : ''}`} ref={boxRef}>
      <button
        type="button"
        className="ss-trigger"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={selected ? 'ss-value' : 'ss-placeholder'}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={15} />
      </button>

      {open && (
        <div className="ss-menu">
          <label className="ss-search">
            <Search size={13} />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Type to search…"
            />
          </label>
          <div className="ss-list">
            {filtered.length === 0 && <div className="ss-empty">No matches</div>}
            {filtered.map((o) => (
              <button
                type="button"
                key={o.value}
                className={`ss-opt${o.value === value ? ' on' : ''}`}
                onClick={() => {
                  onChange(o.value)
                  setOpen(false)
                  setQ('')
                }}
              >
                <span className="ss-opt-main">
                  <span>{o.label}</span>
                  {o.sub && <span className="ss-opt-sub">{o.sub}</span>}
                </span>
                {o.value === value && <Check size={14} />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
