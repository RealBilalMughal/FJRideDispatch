// supabase/functions/flight-info/index.ts
//
// Looks up a flight by IATA number (e.g. "9P841") on AviationStack and
// returns scheduled departure + arrival times plus current status/delay.
// The AVIATION_KEY secret must be set:
//   supabase secrets set AVIATION_KEY=<your_key>
// verify_jwt = on (default): only authenticated dispatchers can call this.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Extract HH:MM from an ISO timestamp (local time at that airport).
// e.g. "2024-10-15T06:30:00+05:00" → "06:30"
function toHHMM(iso: string | null | undefined): string | null {
  if (!iso) return null
  const m = iso.match(/T(\d{2}:\d{2})/)
  return m ? m[1] : null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { flight_iata } = await req.json()
    if (!flight_iata?.trim()) {
      return new Response(
        JSON.stringify({ error: 'flight_iata is required' }),
        { headers: { ...CORS, 'Content-Type': 'application/json' }, status: 400 },
      )
    }

    const key = Deno.env.get('AVIATION_KEY')
    if (!key) {
      return new Response(
        JSON.stringify({ error: 'AVIATION_KEY secret not set' }),
        { headers: { ...CORS, 'Content-Type': 'application/json' }, status: 500 },
      )
    }

    // AviationStack free tier = HTTP only (not HTTPS)
    const url =
      `http://api.aviationstack.com/v1/flights` +
      `?access_key=${key}` +
      `&flight_iata=${encodeURIComponent(flight_iata.trim())}` +
      `&limit=1`

    const res = await fetch(url)
    const json = await res.json()

    if (json.error) {
      return new Response(
        JSON.stringify({ error: json.error.info || 'AviationStack error' }),
        { headers: { ...CORS, 'Content-Type': 'application/json' }, status: 502 },
      )
    }

    if (!json.data || json.data.length === 0) {
      return new Response(
        JSON.stringify({ found: false }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } },
      )
    }

    const f = json.data[0]
    return new Response(
      JSON.stringify({
        found: true,
        flight_iata: f.flight?.iata ?? flight_iata,
        airline: f.airline?.name ?? null,
        status: f.flight_status ?? null,
        departure: {
          airport: f.departure?.airport ?? null,
          iata: f.departure?.iata ?? null,
          scheduled: f.departure?.scheduled ?? null,
          time: toHHMM(f.departure?.scheduled),
          delay: f.departure?.delay ?? null,        // minutes, null = on time
        },
        arrival: {
          airport: f.arrival?.airport ?? null,
          iata: f.arrival?.iata ?? null,
          scheduled: f.arrival?.scheduled ?? null,
          time: toHHMM(f.arrival?.scheduled),
          delay: f.arrival?.delay ?? null,
        },
      }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { headers: { ...CORS, 'Content-Type': 'application/json' }, status: 500 },
    )
  }
})
