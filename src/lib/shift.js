// Global day / night shift window (public.dispatch_settings).
// Day  = [day_start, night_start)    e.g. 08:00 - 20:00
// Night = everything else            e.g. 20:00 - 08:00 (wraps midnight)

export const DEFAULT_SHIFT = { day_start: '08:00', night_start: '20:00' }

const mins = (t) => {
  const [h, m] = String(t || '0:0').slice(0, 5).split(':').map(Number)
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}

// `time` is "HH:MM" (24h) or an ISO string. Returns 'day' | 'night'.
export function shiftForTime(time, settings = DEFAULT_SHIFT) {
  if (!time) return 'day'
  let t
  if (String(time).includes('T')) {
    const d = new Date(time)
    t = d.getHours() * 60 + d.getMinutes()
  } else {
    t = mins(time)
  }
  const ds = mins(settings.day_start)
  const ns = mins(settings.night_start)
  // day runs from day_start up to night_start (assumes day_start < night_start)
  return t >= ds && t < ns ? 'day' : 'night'
}

export function shiftLabel(s) {
  return s === 'night' ? 'Night' : s === 'day' ? 'Day' : '—'
}
