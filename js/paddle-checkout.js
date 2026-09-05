import { initializePaddle } from 'https://esm.sh/@paddle/paddle-js@1.6.5'
import { getSessionUser } from './freemium.js'

let paddleClient = null
let paddleConfig = null
let checkoutError = null
let completedHandler = null

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

function paddleMessage(event) {
  return event?.error?.detail
    || event?.error?.message
    || event?.data?.error?.detail
    || event?.data?.message
    || event?.detail
    || ''
}

async function getPaddle() {
  if (paddleClient) return paddleClient
  const config = await loadPaddleConfig()
  const options = {
    token: config.token,
    eventCallback(event) {
      const name = event?.name || ''
      if (name === 'checkout.completed') {
        completedHandler?.(event)
        return
      }
      if (name === 'checkout.error' || name === 'checkout.warning') {
        checkoutError = paddleMessage(event) || 'Paddle checkout failed'
        console.error('Paddle checkout event', event)
      }
    }
  }
  if (config.environment === 'sandbox') {
    options.environment = 'sandbox'
  }
  paddleClient = await initializePaddle(options)
  if (!paddleClient) {
    throw new Error('Could not initialize Paddle')
  }
  return paddleClient
}

export async function preparePaddle() {
  try {
    await getPaddle()
  } catch (error) {
    if (error.code !== 'not_configured') console.warn(error)
  }
}

export async function openPremiumCheckout({ onCompleted } = {}) {
  const user = await getSessionUser()
  if (!user) {
    const error = new Error('Sign in required')
    error.code = 'signin_required'
    throw error
  }

  const config = await loadPaddleConfig()
  const paddle = await getPaddle()
  completedHandler = onCompleted
  checkoutError = null

  const openOptions = {
    items: [{ priceId: config.priceId, quantity: 1 }],
    customData: {
      user_id: String(user.id)
    },
    settings: {
      displayMode: 'overlay',
      theme: 'light',
      successUrl: window.location.origin
    }
  }
  if (user.email && !/\s/.test(user.email)) {
    openOptions.customer = { email: user.email }
  }

  paddle.Checkout.open(openOptions)

  await new Promise((resolve) => setTimeout(resolve, 800))
  if (checkoutError) {
    const error = new Error(checkoutError)
    error.code = 'checkout_error'
    throw error
  }
}
