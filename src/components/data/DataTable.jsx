import './data.css'

/**
 * columns: [{ key, header, render: (row) => node, align, width }]
 * rows:    array
 * rowKey:  (row) => string
 * selectable / selected(Set) / onToggle(id) / onToggleAll()
 * title / subtitle / headerRight
 */
export default function DataTable({
  columns,
  rows,
  rowKey,
  loading = false,
  emptyLabel = 'Nothing to show',
  selectable = false,
  selected,
  onToggle,
  onToggleAll,
  title,
  subtitle,
  headerRight,
  onRowClick,
  dense = false,
  rowClassName,
}) {
  const colSpan = columns.length + (selectable ? 1 : 0)
  const allChecked = selectable && rows.length > 0 && selected?.size === rows.length

  return (
    <div className="data-table-wrap">
      {(title || headerRight) && (
        <div className="data-table-head">
          <div>
            {title && <h3>{title}</h3>}
            {subtitle && <div className="sub">{subtitle}</div>}
          </div>
          {headerRight}
        </div>
      )}

      <div className="data-table-scroll">
        <table className={`data-table${dense ? ' dense' : ''}`}>
          <thead>
            <tr>
              {selectable && (
                <th className="col-check">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={onToggleAll}
                    aria-label="Select all"
                  />
                </th>
              )}
              {columns.map((c) => (
                <th key={c.key} style={{ width: c.width, textAlign: c.align }}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={`sk-${i}`}>
                  {Array.from({ length: colSpan }).map((__, j) => (
                    <td key={j}>
                      <div className="skeleton-line" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td className="cell-empty" colSpan={colSpan}>
                  {emptyLabel}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const id = rowKey(row)
                const cls = [
                  selectable && selected?.has(id) ? 'selected' : '',
                  rowClassName ? rowClassName(row) : '',
                ]
                  .filter(Boolean)
                  .join(' ')
                return (
                  <tr
                    key={id}
                    className={cls || undefined}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    style={onRowClick ? { cursor: 'pointer' } : undefined}
                  >
                    {selectable && (
                      <td
                        className="col-check"
                        onClick={(e) => {
                          e.stopPropagation()
                          onToggle(id)
                        }}
                      >
                        <input type="checkbox" checked={selected?.has(id) || false} readOnly />
                      </td>
                    )}
                    {columns.map((c) => (
                      <td key={c.key} style={{ textAlign: c.align }}>
                        {c.render(row)}
                      </td>
                    ))}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
