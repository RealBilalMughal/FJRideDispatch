// 24h "14:30:00" -> "14:30" (native <input type="time"> value)
export const toTime24 = (t) => (t ? String(t).slice(0, 5) : '')

// 24h "14:30[:00]" -> "2:30 PM"
export const fmtTime12 = (t) => {
  if (!t) return ''
  const [h, m] = String(t).split(':')
  const hh = Number(h)
  if (!Number.isFinite(hh)) return ''
  const ap = hh >= 12 ? 'PM' : 'AM'
  return `${hh % 12 || 12}:${m} ${ap}`
}

// "14:30" or "2:30 pm" -> "14:30" (24h) | null
export const parseTime = (s) => {
  const mt = String(s ?? '')
    .trim()
    .match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i)
  if (!mt) return null
  let h = Number(mt[1])
  const min = mt[2]
  const ap = mt[3]?.toLowerCase()
  if (Number(min) > 59) return null
  if (ap) {
    if (h < 1 || h > 12) return null
    if (ap === 'pm' && h !== 12) h += 12
    if (ap === 'am' && h === 12) h = 0
  } else if (h > 23) return null
  return `${String(h).padStart(2, '0')}:${min}`
}

// ISO timestamp -> "10 Sep, 2:30 PM"
export const fmtDateTime12 = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

// ISO timestamp -> "2:30 PM" (time only)
export const fmtTimeOnly12 = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })
}

// date "2026-09-10" + time "14:30" -> ISO string in Pakistan time (+05:00)
export const toPkIso = (date, time) => {
  if (!date || !time) return null
  return `${date}T${time.length === 5 ? time : time.slice(0, 5)}:00+05:00`
}

// ISO -> "14:30" local (for a time input)
export const isoToLocalTime = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ISO -> "2026-09-10" local (for a date input)
export const isoToLocalDate = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
