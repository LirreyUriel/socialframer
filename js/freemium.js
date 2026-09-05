import { supabase } from './google-login.js'

const GUEST_KEY = 'sm_guest_id'
const LOCAL_LOG_KEY = 'sm_post_times'
const DAY_MS = 24 * 60 * 60 * 1000

export function getGuestId() {
  try {
    let id = localStorage.getItem(GUEST_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(GUEST_KEY, id)
    }
    return id
  } catch {
    return 'anonymous'
  }
}

function readLocalTimes() {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_LOG_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter((value) => typeof value === 'number') : []
  } catch {
    return []
  }
}

function appendLocalTime() {
  const next = [...readLocalTimes(), Date.now()].filter((value) => Date.now() - value < DAY_MS)
  try {
    localStorage.setItem(LOCAL_LOG_KEY, JSON.stringify(next))
  } catch {
    /* ignore quota */
  }
  return next.length
}

function localUsage(isSignedIn) {
  const count = readLocalTimes().filter((value) => Date.now() - value < DAY_MS).length
  let action = 'allow'
  if (!isSignedIn && count >= 1) action = 'require_login'
  else if (count >= 2) action = 'watermark'
  return {
    action,
    allowed: action !== 'require_login',
    count,
    is_premium: false,
    source: 'local'
  }
}

function normalizeUsage(data, fallbackSignedIn) {
  if (!data || typeof data !== 'object') return localUsage(fallbackSignedIn)
  const action = data.action === 'require_login' || data.action === 'watermark' ? data.action : 'allow'
  return {
    action,
    allowed: data.allowed !== false && action !== 'require_login',
    count: Number(data.count) || 0,
    is_premium: Boolean(data.is_premium),
    watermarked: Boolean(data.watermarked),
    post_id: data.post_id || null,
    source: 'supabase'
  }
}

export async function getSessionUser() {
  const { data } = await supabase.auth.getSession()
  return data.session?.user || null
}

export async function getUsage() {
  const user = await getSessionUser()
  const { data, error } = await supabase.rpc('get_usage', { p_guest_id: getGuestId() })
  if (error) {
    console.warn('get_usage unavailable, using local fallback', error.message)
    return localUsage(Boolean(user))
  }
  return normalizeUsage(data, Boolean(user))
}

export async function saveBrandKit(kit) {
  const user = await getSessionUser()
  if (!user) {
    const error = new Error('Sign in required')
    error.code = 'signin_required'
    throw error
  }
  const payload = {
    name: String(kit.name || '').slice(0, 120),
    headline: String(kit.headline || '').slice(0, 180),
    handle: String(kit.handle || '').slice(0, 60),
    verified: Boolean(kit.verified),
    avatar_url: String(kit.avatar_url || '').slice(0, 2000),
    colors: {
      primary: String(kit.colors?.primary || '#2563eb').slice(0, 16),
      secondary: String(kit.colors?.secondary || '#0ea5e9').slice(0, 16),
      accent: String(kit.colors?.accent || '#ec4899').slice(0, 16)
    }
  }
  const { data, error } = await supabase.rpc('save_brand_kit', { p_kit: payload })
  if (error) {
    const fallback = await getUsage()
    if (!fallback.is_premium) {
      const denied = new Error('Premium required')
      denied.code = 'premium_required'
      throw denied
    }
    throw error
  }
  if (data?.ok === false || data?.error === 'premium_required') {
    const denied = new Error('Premium required')
    denied.code = 'premium_required'
    throw denied
  }
  return data?.kit || payload
}

export async function loadBrandKit() {
  const { data, error } = await supabase.rpc('get_brand_kit')
  if (error || !data?.kit) return null
  return data.kit
}

export async function recordPost({ platform, content, scheduledDate, postId }) {
  const user = await getSessionUser()
  const before = localUsage(Boolean(user))
  if (postId && user) {
    const { data, error } = await supabase.rpc('update_post', {
      p_id: postId,
      p_platform: platform,
      p_content: content || '',
      p_scheduled_date: scheduledDate || null
    })
    if (!error && data?.ok !== false) {
      return {
        ...before,
        action: 'allow',
        allowed: true,
        post_id: postId,
        updated: true,
        source: 'supabase'
      }
    }
  }
  let { data, error } = await supabase.rpc('create_post', {
    p_guest_id: getGuestId(),
    p_platform: platform,
    p_content: content || '',
    p_scheduled_date: scheduledDate || undefined
  })
  if (error) {
    const retry = await supabase.rpc('create_post', {
      p_guest_id: getGuestId(),
      p_platform: platform,
      p_content: content || ''
    })
    data = retry.data
    error = retry.error
  }
  appendLocalTime()
  if (error) {
    console.warn('create_post unavailable, recorded locally', error.message)
    return {
      ...before,
      count: before.count + 1,
      source: 'local'
    }
  }
  return normalizeUsage(data, Boolean(user))
}
