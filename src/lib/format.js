const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// 01-Aug-26
// A bare date string like '2026-09-15' is parsed as UTC midnight by browsers.
// Using local getDate()/getMonth() would give the wrong day for any user whose
// browser timezone is behind UTC (e.g. UTC-5 → shows Sep 14). Use UTC getters
// for date-only values; use local getters for timestamps (which include time).
export function fmtDate(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  // Date-only strings (YYYY-MM-DD) are UTC midnight — read in UTC so the day
  // never shifts. Timestamps (contain 'T') carry their own offset, use local.
  const dateOnly = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  const dd = String(dateOnly ? d.getUTCDate() : d.getDate()).padStart(2, '0')
  const mon = dateOnly ? d.getUTCMonth() : d.getMonth()
  const yy = String(dateOnly ? d.getUTCFullYear() : d.getFullYear()).slice(-2)
  return `${dd}-${MONTHS[mon]}-${yy}`
}

// 01-Aug-26 02:30 PM
export function fmtDateTime(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  const h = d.getHours()
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${fmtDate(value)} ${h12}:${mm} ${ampm}`
}
