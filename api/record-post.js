const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bawcojqjzbnlblhpvzja.supabase.co'
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJhd2NvanFqemJubGJsaHB2emphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2Mjg3ODUsImV4cCI6MjEwNDIwNDc4NX0.Q3q-yOjwCfNOH7Oep21g69z86d5VP3rq0jQ5mGgCX4g'

function parseBody(req) {
  let payload = req.body
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload || '{}')
    } catch {
      return null
    }
  }
  return payload && typeof payload === 'object' ? payload : {}
}

async function callRpc(name, args, authorization) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: authorization || `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(args)
  })
  const data = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, data }
}

export default async function handler(req, res) {
  res.setHeader('Allow', 'GET, POST')
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' })
  }

  const body = req.method === 'POST' ? parseBody(req) : {}
  if (body === null) {
    return res.status(400).json({ ok: false, error: 'Invalid JSON' })
  }

  const guestId = String(req.query?.guest_id || body.guest_id || '')
  const authorization = req.headers.authorization

  if (req.method === 'GET') {
    const result = await callRpc('get_usage', { p_guest_id: guestId }, authorization)
    return res.status(result.ok ? 200 : result.status).json(result.data)
  }

  const result = await callRpc('create_post', {
    p_guest_id: guestId,
    p_platform: String(body.platform || 'linkedin'),
    p_content: String(body.content || '')
  }, authorization)

  return res.status(result.ok ? 200 : result.status).json(result.data)
}
