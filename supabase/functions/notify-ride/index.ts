// supabase/functions/notify-ride/index.ts
//
// Provider-agnostic ride notification. The client calls this with { ride_id };
// it renders the city's message template, then POSTs a JSON payload (ride
// details + recipient phones + the message) to that city's
// `notify_webhook_url` (set at Settings -> Notifications). Whatever sits behind
// that URL - Zapier / Make / a gateway script / the WhatsApp Business API -
// does the actual sending. Every attempt is logged in `ride_notifications`.
//
// verify_jwt = on (default): the caller's token scopes the ride read (RLS), and
// identifies `sent_by`. Supabase injects SUPABASE_URL / *_ANON_KEY /
// *_SERVICE_ROLE_KEY.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const DEFAULT_TEMPLATE = [
  'FJ Ride {{ref}} — {{block}} on {{date}}',
  'Flight {{flight}} · {{time_label}} {{time}}',
  '{{origin}} → {{dest}}',
  'Vehicle {{vehicle}} · Driver {{driver}}',
].join('\n')

const fmtDate = (d: string) => {
  const [y, m, day] = String(d).split('-')
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1]
  return `${day}-${mon}-${String(y).slice(2)}`
}
const fmtTime = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(new Date(iso).getTime() + 5 * 3600_000) // Pakistan
  let h = d.getUTCHours()
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  const ap = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${mm} ${ap}`
}
const timeLabel = (b: string) => (b === 'pickup' ? 'Pickup' : b === 'dropoff' ? 'Drop' : 'Ride')
const blockLabel = (b: string) =>
  ({ pickup: 'Pickup', dropoff: 'Drop Off', deadhead: 'Deadhead', return_leg: 'Return leg' })[b] || b

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const auth = req.headers.get('Authorization') ?? ''
  let ride_id: string
  try {
    ride_id = (await req.json()).ride_id
  } catch {
    return json({ error: 'bad body' }, 400)
  }
  if (!ride_id) return json({ error: 'ride_id required' }, 400)

  const user = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } })
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

  const { data: me } = await user.auth.getUser()
  if (!me?.user) return json({ error: 'not signed in' }, 401)

  // RLS scopes this to a ride the caller can see
  const { data: ride, error } = await user
    .from('rides')
    .select(
      `id, city_id, ref_no, flight_no, flight_code, block_type, ride_date, start_at,
       origin_label, dest_label,
       vehicle:vehicles(vehicle_no),
       driver:drivers!rides_driver_id_fkey(name, contact),
       ride_crew(crew:crew(name, contact))`,
    )
    .eq('id', ride_id)
    .maybeSingle()
  if (error) return json({ error: error.message }, 500)
  if (!ride) return json({ error: 'ride not found or no access' }, 404)

  const { data: city } = await user
    .from('cities')
    .select('name, notify_webhook_url, notify_template')
    .eq('id', ride.city_id)
    .maybeSingle()
  if (!city?.notify_webhook_url) {
    return json({ error: `No notification webhook set for ${city?.name ?? 'this city'} (Settings → Notifications).` }, 400)
  }

  const recipients = [
    ride.driver?.contact
      ? { name: ride.driver.name, phone: ride.driver.contact, role: 'driver' }
      : null,
    ...(ride.ride_crew || []).map((x: { crew?: { name?: string; contact?: string } }) =>
      x.crew?.contact ? { name: x.crew.name, phone: x.crew.contact, role: 'crew' } : null,
    ),
  ].filter(Boolean)

  const vars: Record<string, string> = {
    ref: String(ride.ref_no),
    block: blockLabel(ride.block_type),
    date: fmtDate(ride.ride_date),
    flight: `${ride.flight_no ?? '—'}${ride.flight_code ? ' ' + ride.flight_code : ''}`,
    time: fmtTime(ride.start_at),
    time_label: timeLabel(ride.block_type),
    origin: ride.origin_label ?? '—',
    dest: ride.dest_label ?? '—',
    vehicle: ride.vehicle?.vehicle_no ?? '—',
    driver: ride.driver?.name ?? '—',
  }
  const message = (city.notify_template || DEFAULT_TEMPLATE).replace(
    /\{\{\s*(\w+)\s*\}\}/g,
    (_m, k) => vars[k] ?? '',
  )

  let ok = false
  let detail = ''
  try {
    const res = await fetch(city.notify_webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'ride_notify',
        ride: { id: ride.id, ref_no: ride.ref_no, ...vars },
        message,
        recipients,
      }),
    })
    ok = res.ok
    detail = `${res.status} ${res.statusText}`.trim()
  } catch (e) {
    detail = String((e as Error).message ?? e)
  }

  await admin.from('ride_notifications').insert({
    ride_id: ride.id,
    city_id: ride.city_id,
    sent_by: me.user.id,
    ok,
    recipients: recipients.length,
    detail: detail.slice(0, 300),
  })

  return json({ ok, recipients: recipients.length, detail }, ok ? 200 : 502)
})
