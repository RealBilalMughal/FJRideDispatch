const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// 01-Aug-26
export function fmtDate(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  const dd = String(d.getDate()).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(-2)
  return `${dd}-${MONTHS[d.getMonth()]}-${yy}`
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
