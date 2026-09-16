import Anthropic from 'npm:@anthropic-ai/sdk@0.30.0'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const { image_base64, mime_type } = await req.json()
    if (!image_base64) {
      return new Response(JSON.stringify({ km: null }), { headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    const client = new Anthropic()
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 32,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: (mime_type ?? 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: image_base64,
            },
          },
          {
            type: 'text',
            text: 'This is a vehicle odometer photo. Read the TOTAL odometer KM reading shown (the main large number, not the trip meter). Reply with ONLY the number, no text, no units, no commas. Example: 87432. If you cannot read it clearly, reply: null',
          },
        ],
      }],
    })

    const raw = ((msg.content[0] as { type: string; text: string }).text ?? '').trim()
    const cleaned = raw.replace(/[^0-9.]/g, '')
    const km = cleaned ? parseFloat(cleaned) : null

    return new Response(
      JSON.stringify({ km: Number.isFinite(km) ? km : null, raw }),
      { headers: { ...cors, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ km: null, error: String(err) }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
    )
  }
})
