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

  console.log('[event]', {
    source: 'studio',
    event: 'Download Image',
    at: payload.at || new Date().toISOString(),
    platform: payload.platform,
    profileName: payload.profileName,
    uploadedAvatar: payload.uploadedAvatar,
    attachedScreenshot: payload.attachedScreenshot,
    watermark: payload.watermark,
    postCount: payload.postCount,
    freemiumAction: payload.freemiumAction,
    content: payload.content
  })

  return res.status(204).end()
}
