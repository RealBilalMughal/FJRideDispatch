import './data.css'

const PAGE_SIZE_OPTIONS = [25, 50, 75, 100]

export default function Pagination({ page, pageSize, total, onPage, onPageSize }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize && !onPageSize) return null

  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)

  const windowStart = Math.max(1, Math.min(page - 3, totalPages - 6))
  const pages = Array.from({ length: Math.min(totalPages, 7) }, (_, i) => windowStart + i).filter(
    (p) => p <= totalPages,
  )

  return (
    <div className="pagination">
      <span className="pg-info">
        Showing {start}&ndash;{end} of {total.toLocaleString()}
      </span>
      {onPageSize && (
        <select
          className="pg-size-select"
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
        >
          {PAGE_SIZE_OPTIONS.map((s) => (
            <option key={s} value={s}>{s} / page</option>
          ))}
        </select>
      )}
      {total > pageSize && (
        <div className="pg-btns">
          <button type="button" onClick={() => onPage(page - 1)} disabled={page === 1}>
            Prev
          </button>
          {pages.map((p) => (
            <button
              key={p}
              type="button"
              className={p === page ? 'active' : undefined}
              onClick={() => onPage(p)}
            >
              {p}
            </button>
          ))}
          <button type="button" onClick={() => onPage(page + 1)} disabled={page === totalPages}>
            Next
          </button>
        </div>
      )}
    </div>
  )
}
