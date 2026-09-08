import { supabase } from './supabase'

// Fire a ride notification through the `notify-ride` Edge Function (which POSTs
// to the city's notify_webhook_url). Returns { ok, recipients, detail } or
// { ok: false, error }.
export async function notifyRide(rideId) {
  const { data, error } = await supabase.functions.invoke('notify-ride', {
    body: { ride_id: rideId },
  })
  if (error) {
    let msg = error.message
    try {
      const body = await error.context?.json?.()
      if (body?.error) msg = body.error
      else if (body?.detail) msg = body.detail
    } catch {
      /* keep error.message */
    }
    return { ok: false, error: msg }
  }
  return data
}
