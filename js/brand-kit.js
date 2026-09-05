import { supabase } from './google-login.js'
import { getSessionUser, saveBrandKit, loadBrandKit } from './freemium.js'

const DEFAULT_COLORS = {
  primary: '#2563eb',
  secondary: '#0ea5e9',
  accent: '#ec4899'
}

export function defaultBrandColors() {
  return { ...DEFAULT_COLORS }
}

export function hexToRgba(hex, alpha) {
  const value = String(hex || '').replace('#', '')
  if (value.length !== 6) return `rgba(37,99,235,${alpha})`
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

export function applyBrandColors(colors, stage) {
  const palette = { ...DEFAULT_COLORS, ...(colors || {}) }
  if (!stage) return palette
  stage.style.setProperty('--wash-a', hexToRgba(palette.primary, 0.16))
  stage.style.setProperty('--wash-b', hexToRgba(palette.secondary, 0.12))
  document.documentElement.style.setProperty('--brand-primary', palette.primary)
  document.documentElement.style.setProperty('--brand-accent', palette.accent)
  return palette
}

export function normalizeKit(kit) {
  if (!kit || typeof kit !== 'object') return null
  return {
    name: kit.name || '',
    headline: kit.headline || '',
    handle: kit.handle || '',
    verified: Boolean(kit.verified),
    avatar_url: kit.avatar_url || kit.avatarUrl || '',
    colors: {
      ...DEFAULT_COLORS,
      ...(kit.colors || {})
    }
  }
}

export async function fetchBrandKit() {
  const user = await getSessionUser()
  if (!user) return { user: null, kit: null }
  const kit = normalizeKit(await loadBrandKit())
  return { user, kit }
}

export async function persistBrandKit(kit) {
  const user = await getSessionUser()
  if (!user) {
    const error = new Error('Sign in to save your brand kit')
    error.code = 'signin_required'
    throw error
  }
  const saved = await saveBrandKit(kit)
  return normalizeKit(saved) || normalizeKit(kit)
}

export async function uploadBrandAvatar(file) {
  const user = await getSessionUser()
  if (!user) {
    const error = new Error('Sign in to upload an avatar')
    error.code = 'signin_required'
    throw error
  }
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('Choose an image file')
  }
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
  const path = `${user.id}/avatar-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('avatars').upload(path, file, {
    upsert: true,
    contentType: file.type
  })
  if (error) {
    const failed = new Error(error.message || 'Avatar upload failed')
    failed.code = 'upload_failed'
    throw failed
  }
  const { data } = supabase.storage.from('avatars').getPublicUrl(path)
  return data.publicUrl
}
