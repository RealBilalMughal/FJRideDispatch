// supabase/functions/ors-route/index.ts
//
// Server-side proxy for OpenRouteService directions. Browser requests to ORS
// fail on some networks (CORS preflight blocked by ISP). This function runs
// on Supabase's servers, bypassing the restriction.
//
// verify_jwt = off (no user token needed for a routing call; rate-limited by
// Supabase invocation limits). ORS_API_KEY stored as a Supabase secret.
//
// Deploy: supabase functions deploy ors-route --no-verify-jwt --use-api
// Secret: supabase secrets set ORS_API_KEY=<key>

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const KEY = Deno.env.get('ORS_API_KEY')
  if (!KEY) return json({ error: 'ORS_API_KEY secret not set' }, 500)

  let body: unknown
  try { body = await req.json() } catch { return json({ error: 'invalid JSON body' }, 400) }

  const res = await fetch(
    'https://api.openrouteservice.org/v2/directions/driving-car/geojson',
    {
      method: 'POST',
      headers: { Authorization: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )

  const text = await res.text()
  if (!res.ok) {
    console.error('[ors-route] ORS error', res.status, text)
    return json({ error: text }, res.status)
  }

  let data: unknown
  try { data = JSON.parse(text) } catch { return json({ error: 'ORS returned non-JSON' }, 502) }
  return json(data)
})
