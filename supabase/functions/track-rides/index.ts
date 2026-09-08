// supabase/functions/track-rides/index.ts
//
// AI Tracker poll. Scheduled by pg_cron (migration
// 20260908140100_ride_track_cron.sql) once a minute; each run loops ~6x with a
// 10s gap, so an active ride gets a GPS sample roughly every 10 seconds.
//
// For every currently-active ride (has a vehicle, status dispatched/enroute,
// its time window straddles "now") it reads that ride's CITY fleet tracker
// link (`cities.tracker_url`) once - one call returns every vehicle - matches
// the ride's vehicle by plate, and appends a row to `ride_track_points`.
// verify_jwt = false; guarded by the `x-track-cron-key` header == TRACK_CRON_KEY
// (an Edge Function secret), whose twin lives in the DB vault so cron can send
// it. Supabase injects SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CRON_KEY = Deno.env.get('TRACK_CRON_KEY') ?? ''

const LOOPS = 6
const GAP_MS = 10_000
const plate = (s: unknown) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, '')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// a city sharing link -> that city's /items endpoint (all vehicles)
function itemsUrl(shareUrl: string) {
  try {
    const u = new URL(shareUrl)
    return `${u.origin}${u.pathname.replace(/\/$/, '')}/items?time=0&_=${Date.now()}`
  } catch {
    return null
  }
}

async function fetchItems(shareUrl: string) {
  const url = itemsUrl(shareUrl)
  if (!url) return []
  try {
    const res = await fetch(url)
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data?.items) ? data.items : []
  } catch {
    return []
  }
}

Deno.serve(async (req) => {
  if (CRON_KEY && req.headers.get('x-track-cron-key') !== CRON_KEY) {
    return new Response('unauthorized', { status: 401 })
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE)
  const now = Date.now()
  const soon = new Date(now + 15 * 60_000).toISOString()
  const grace = new Date(now - 30 * 60_000).toISOString()

  const { data: rides, error } = await supabase
    .from('rides')
    .select('id, city_id, vehicle:vehicles(vehicle_no)')
    .in('status', ['dispatched', 'enroute'])
    .not('vehicle_id', 'is', null)
    .lte('start_at', soon)
    .gte('end_at', grace)

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  if (!rides?.length) return new Response(JSON.stringify({ active: 0 }))

  const cityIds = [...new Set(rides.map((r) => r.city_id))]
  const { data: cities } = await supabase.from('cities').select('id, tracker_url').in('id', cityIds)
  const urlByCity: Record<number, string> = {}
  for (const c of cities ?? []) if (c.tracker_url) urlByCity[c.id] = c.tracker_url

  // plate -> [{ ride_id, city_id }]
  const byPlate = new Map<string, { ride_id: string; city_id: number }[]>()
  for (const r of rides) {
    if (!urlByCity[r.city_id]) continue
    const p = plate((r.vehicle as { vehicle_no?: string } | null)?.vehicle_no)
    if (!p) continue
    if (!byPlate.has(p)) byPlate.set(p, [])
    byPlate.get(p)!.push({ ride_id: r.id, city_id: r.city_id })
  }
  if (byPlate.size === 0) return new Response(JSON.stringify({ active: rides.length, tracked: 0 }))

  const urls = [...new Set(rides.map((r) => urlByCity[r.city_id]).filter(Boolean))] as string[]
  let written = 0

  for (let i = 0; i < LOOPS; i++) {
    if (i > 0) await sleep(GAP_MS)
    const itemLists = await Promise.all(urls.map(fetchItems))
    const rows: Record<string, unknown>[] = []
    const at = new Date().toISOString()
    for (const items of itemLists) {
      for (const it of items) {
        const targets = byPlate.get(plate(it.name))
        if (!targets) continue
        const lat = Number(it.lat)
        const lng = Number(it.lng)
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
        for (const t of targets) {
          rows.push({
            ride_id: t.ride_id,
            city_id: t.city_id,
            at,
            lat,
            lng,
            speed: Number(it.speed) || 0,
            status: it.icon_color ?? null,
          })
        }
      }
    }
    if (rows.length) {
      const { error: insErr } = await supabase.from('ride_track_points').insert(rows)
      if (!insErr) written += rows.length
    }
  }

  return new Response(JSON.stringify({ active: rides.length, points_written: written }))
})
