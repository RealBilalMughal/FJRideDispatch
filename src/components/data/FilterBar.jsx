import { useState } from 'react'
import { Filter, Search, X } from 'lucide-react'
import './data.css'

/**
 * search / onSearch   - controlled search text
 * inline              - node: always-visible controls (selects, toggles)
 * advanced            - node: collapsible grid of labelled filters
 * activeCount         - number of non-default filters (shows Clear + badge)
 * onClear             - reset everything
 */
export default function FilterBar({
  search,
  onSearch,
  searchPlaceholder = 'Search...',
  inline,
  advanced,
  activeCount = 0,
  onClear,
}) {
  const [open, setOpen] = useState(false)

  return (
    <div>
      <div className="filter-bar">
        <label className="filter-search">
          <Search size={14} />
          <input
            type="search"
            value={search}
            placeholder={searchPlaceholder}
            onChange={(e) => onSearch(e.target.value)}
          />
        </label>

        {inline}

        {advanced && (
          <button
            type="button"
            className={`filter-toggle${open || activeCount > 0 ? ' on' : ''}`}
            onClick={() => setOpen((v) => !v)}
          >
            <Filter size={13} />
            Filters
            {activeCount > 0 && <span className="count">{activeCount}</span>}
          </button>
        )}

        {activeCount > 0 && onClear && (
          <button type="button" className="filter-clear" onClick={onClear}>
            <X size={13} />
            Clear
          </button>
        )}
      </div>

      {advanced && open && <div className="filter-advanced">{advanced}</div>}
    </div>
  )
}
