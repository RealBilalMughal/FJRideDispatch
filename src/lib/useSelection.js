import { useCallback, useState } from 'react'

// Row-selection state for a list table. `toggleAll` takes the currently visible
// rows so "select all" toggles the page, not the whole dataset.
export function useSelection() {
  const [selected, setSelected] = useState(() => new Set())

  const toggle = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback((rows) => {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))))
  }, [])

  const clear = useCallback(() => setSelected(new Set()), [])

  return { selected, toggle, toggleAll, clear }
}
