export default function handler(req, res) {
  res.setHeader('Allow', 'POST')
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' })
  }

  let payload = req.body
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload || '{}')
    } catch {
      return res.status(400).json({ ok: false, error: 'Invalid JSON' })
    }
  }
  payload = payload && typeof payload === 'object' ? payload : {}

  const event = String(payload.event || 'Unknown').slice(0, 80)
  const entry = {
    source: 'studio',
    event,
    at: payload.at || new Date().toISOString(),
    path: payload.path || '',
    platform: payload.platform || null,
    sourceUi: payload.source || null,
    userId: payload.userId || null,
    provider: payload.provider || null,
    scheduledDate: payload.scheduledDate || null,
    updated: payload.updated ?? null,
    isPremium: payload.isPremium ?? null,
    watermark: payload.watermark ?? null,
    postCount: payload.postCount ?? null,
    freemiumAction: payload.freemiumAction || null,
    profileName: payload.profileName || null,
    uploadedAvatar: payload.uploadedAvatar ?? null,
    attachedScreenshot: payload.attachedScreenshot ?? null,
    error: payload.error || null
  }

  console.log('[event]', entry)

  return res.status(204).end()
}
