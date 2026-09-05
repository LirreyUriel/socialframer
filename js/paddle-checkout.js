import { initializePaddle } from 'https://esm.sh/@paddle/paddle-js@1.6.5'
import { getSessionUser } from './freemium.js'

let paddleClient = null
let paddleConfig = null

export async function loadPaddleConfig() {
  if (paddleConfig) return paddleConfig
  const response = await fetch('/api/paddle-config', {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.configured) {
    const error = new Error(data.error || 'Paddle is not configured')
    error.code = 'not_configured'
    throw error
  }
  paddleConfig = data
  return paddleConfig
}

async function getPaddle(onCompleted) {
  const config = await loadPaddleConfig()
  if (paddleClient) return paddleClient
  paddleClient = await initializePaddle({
    token: config.token,
    environment: config.environment === 'production' ? 'production' : 'sandbox',
    eventCallback(event) {
      if (event?.name === 'checkout.completed') {
        onCompleted?.(event)
      }
    }
  })
  if (!paddleClient) {
    throw new Error('Could not initialize Paddle')
  }
  return paddleClient
}

export async function openPremiumCheckout({ onCompleted } = {}) {
  const user = await getSessionUser()
  if (!user) {
    const error = new Error('Sign in required')
    error.code = 'signin_required'
    throw error
  }

  const config = await loadPaddleConfig()
  const paddle = await getPaddle(onCompleted)
  await paddle.Checkout.open({
    items: [{ priceId: config.priceId, quantity: 1 }],
    customer: user.email ? { email: user.email } : undefined,
    customData: {
      user_id: user.id
    },
    settings: {
      displayMode: 'overlay',
      theme: 'light'
    }
  })
}
