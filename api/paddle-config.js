function firstEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key]
    if (value) return value
  }
  return ''
}

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' })
  }

  const token = firstEnv('NEXT_PUBLIC_PADDLE_CLIENT_TOKEN', 'PADDLE_CLIENT_TOKEN').trim()
  const priceId = firstEnv('NEXT_PUBLIC_PADDLE_PRICE_ID', 'PADDLE_PRICE_ID').trim()
  const explicitEnv = firstEnv('NEXT_PUBLIC_PADDLE_ENVIRONMENT', 'PADDLE_ENVIRONMENT').trim().toLowerCase()
  const environment = explicitEnv === 'production' || explicitEnv === 'sandbox'
    ? explicitEnv
    : token.startsWith('test_')
      ? 'sandbox'
      : 'production'

  if (!token || !priceId) {
    return res.status(503).json({
      ok: false,
      configured: false,
      error: 'Paddle is not configured'
    })
  }

  return res.status(200).json({
    ok: true,
    configured: true,
    token,
    priceId,
    environment
  })
}
