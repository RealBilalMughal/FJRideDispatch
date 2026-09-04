// Day / night shift label. Which driver a ride uses is a manual Day/Night
// pick (see the toggle in Rides.jsx's RideModal) - there's no time-of-day
// auto-detection or global shift window anymore (that used to live in
// public.dispatch_settings, edited from the Vehicles page; removed).

export function shiftLabel(s) {
  return s === 'night' ? 'Night' : s === 'day' ? 'Day' : '—'
}
