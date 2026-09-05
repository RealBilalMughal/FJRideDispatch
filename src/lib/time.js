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

// "Now", as Pakistan wall-clock time - safe to read with the UTC getters
// (getUTCFullYear/Month/Date/Day) regardless of what timezone the browser
// itself is set to. Pakistan is a fixed UTC+5, no DST, so shifting the
// current instant by that offset and then reading its UTC fields gives the
// correct Pakistan calendar date/time every time.
// Plain `new Date().toISOString()` is NOT safe for this: it's always UTC, so
// during Pakistan's early-morning hours (12:00–4:59 AM PKT) it still reports
// the PREVIOUS calendar day - e.g. a ride dated "today" in Pakistan wouldn't
// match a "today" filter computed that way. This bit everyone: default ride
// dates, the Today/Week/Month filter presets, CSV export filename stamps.
const PK_OFFSET_MS = 5 * 60 * 60 * 1000
export const pkNow = () => new Date(Date.now() + PK_OFFSET_MS)

// "2026-09-05" - today's date in Pakistan time, regardless of the browser's
// own timezone.
export const pkToday = () => pkNow().toISOString().slice(0, 10)

// an ISO instant -> its Pakistan-local hour (0-23) and weekday (0=Sun..6=Sat),
// regardless of the browser's own timezone (same +5h-then-UTC-getters trick
// as pkNow above).
export const pkHourWeekday = (iso) => {
  const d = new Date(new Date(iso).getTime() + PK_OFFSET_MS)
  return { hour: d.getUTCHours(), weekday: d.getUTCDay() }
}

// "2026-09-05" + n -> "2026-09-05 + n days" (n may be negative). Pure
// calendar-date arithmetic via Date.UTC on the date's own Y/M/D - never local-
// timezone Date parsing/getters, so it's independent of the browser's own
// timezone (same reasoning as pkNow/pkToday above).
export const addDays = (isoDate, n) => {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

// A Today/Week/Month/All quick-filter preset -> a concrete { from, to } pair
// of "YYYY-MM-DD" strings ({ from: '', to: '' } for "all"). Week = Mon–Sun of
// the current week, Month = the calendar month - both anchored on pkToday()
// and computed with Date.UTC on its Y/M/D so they're independent of the
// browser's own timezone (same reasoning as addDays above). Shared by the
// Rides filter bar and the Dashboard.
export const presetRange = (preset) => {
  const today = pkToday()
  if (preset === 'today') return { from: today, to: today }
  if (preset === 'week') {
    const [y, m, d] = today.split('-').map(Number)
    const anchor = new Date(Date.UTC(y, m - 1, d))
    const mon = new Date(anchor)
    mon.setUTCDate(anchor.getUTCDate() - ((anchor.getUTCDay() + 6) % 7))
    const sun = new Date(mon)
    sun.setUTCDate(mon.getUTCDate() + 6)
    return { from: mon.toISOString().slice(0, 10), to: sun.toISOString().slice(0, 10) }
  }
  if (preset === 'month') {
    const [y, m] = today.split('-').map(Number)
    return {
      from: new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10),
      to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10),
    }
  }
  return { from: '', to: '' }
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
