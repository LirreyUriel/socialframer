import crypto from 'node:crypto'

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bawcojqjzbnlblhpvzja.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const WEBHOOK_SECRET = process.env.PADDLE_WEBHOOK_SECRET || ''
const GRANT_EVENTS = new Set(['transaction.completed', 'subscription.activated'])
const REVOKE_EVENTS = new Set(['subscription.canceled'])

export const config = {
  api: {
    bodyParser: false
  }
}

function readRawBody(req) {
  if (typeof req.rawBody === 'string') return Promise.resolve(req.rawBody)
  if (Buffer.isBuffer(req.rawBody)) return Promise.resolve(req.rawBody.toString('utf8'))
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function parseSignature(header) {
  const parts = String(header || '').split(';')
  const parsed = {}
  for (const part of parts) {
    const [key, ...rest] = part.split('=')
    if (key && rest.length) parsed[key.trim()] = rest.join('=').trim()
  }
  return parsed
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left))
  const b = Buffer.from(String(right))
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

function verifyPaddleSignature(rawBody, header, secret) {
  const { ts, h1 } = parseSignature(header)
  if (!ts || !h1 || !secret) return false
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(ts))
  if (!Number.isFinite(age) || age > 60 * 10) return false
  const digest = crypto.createHmac('sha256', secret).update(`${ts}:${rawBody}`, 'utf8').digest('hex')
  return safeEqual(digest, h1)
}

function extractUserId(data) {
  const custom = data?.custom_data || {}
  return custom.user_id || custom.userId || custom.supabase_user_id || null
}

async function supabaseRequest(path, { method = 'GET', query = '', body } = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}${query}`
  const response = await fetch(url, {
    method,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error((data && data.message) || `Supabase ${response.status}`)
  }
  return data
}

async function markPremium({ userId, customerId, email, isPremium }) {
  if (!SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')
  }

  const patch = { is_premium: isPremium }
  if (customerId) patch.paddle_customer_id = customerId

  async function patchProfile(query) {
    try {
      return await supabaseRequest('profiles', { method: 'PATCH', query, body: patch })
    } catch (error) {
      if (!patch.paddle_customer_id) throw error
      const { paddle_customer_id, ...basic } = patch
      return supabaseRequest('profiles', { method: 'PATCH', query, body: basic })
    }
  }

  if (userId) {
    const updated = await patchProfile(`?id=eq.${encodeURIComponent(userId)}`)
    if (!updated || updated.length === 0) {
      await supabaseRequest('profiles', {
        method: 'POST',
        body: { id: userId, is_premium: isPremium, email: email || null }
      })
    }
    return { userId }
  }

  if (customerId) {
    const byCustomer = await supabaseRequest('profiles', {
      query: `?paddle_customer_id=eq.${encodeURIComponent(customerId)}&select=id`
    })
    if (byCustomer?.[0]?.id) {
      await patchProfile(`?id=eq.${encodeURIComponent(byCustomer[0].id)}`)
      return { userId: byCustomer[0].id }
    }
  }

  if (email) {
    const byEmail = await supabaseRequest('profiles', {
      query: `?email=eq.${encodeURIComponent(email)}&select=id`
    })
    if (byEmail?.[0]?.id) {
      await patchProfile(`?id=eq.${encodeURIComponent(byEmail[0].id)}`)
      return { userId: byEmail[0].id }
    }
  }

  throw new Error('Could not match a Supabase profile for this Paddle event')
}

export default async function handler(req, res) {
  res.setHeader('Allow', 'POST')
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' })
  }

  let rawBody = ''
  try {
    rawBody = await readRawBody(req)
  } catch {
    return res.status(400).json({ ok: false, error: 'Could not read body' })
  }

  const signature = req.headers['paddle-signature']
  if (!verifyPaddleSignature(rawBody, signature, WEBHOOK_SECRET)) {
    return res.status(401).json({ ok: false, error: 'Invalid Paddle signature' })
  }

  let event
  try {
    event = JSON.parse(rawBody)
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid JSON' })
  }

  const eventType = event.event_type || event.eventType
  if (!GRANT_EVENTS.has(eventType) && !REVOKE_EVENTS.has(eventType)) {
    return res.status(200).json({ ok: true, ignored: eventType || 'unknown' })
  }

  const isPremium = GRANT_EVENTS.has(eventType)
  const data = event.data || {}

  try {
    const result = await markPremium({
      userId: extractUserId(data),
      customerId: data.customer_id || null,
      email: data.customer?.email || data.details?.customer?.email || null,
      isPremium
    })
    console.log('[event]', {
      source: 'paddle',
      event: isPremium ? 'Premium Granted' : 'Premium Revoked',
      at: new Date().toISOString(),
      eventType,
      userId: result.userId || extractUserId(data) || null
    })
    return res.status(200).json({ ok: true, eventType, ...result, is_premium: isPremium })
  } catch (error) {
    console.error('[paddle webhook]', error)
    return res.status(500).json({ ok: false, error: error.message })
  }
}
