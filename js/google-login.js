import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.115.0'

const SUPABASE_URL = 'https://bawcojqjzbnlblhpvzja.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJhd2NvanFqemJubGJsaHB2emphIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2Mjg3ODUsImV4cCI6MjEwNDIwNDc4NX0.Q3q-yOjwCfNOH7Oep21g69z86d5VP3rq0jQ5mGgCX4g'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

export async function signInWithGoogle() {
  if (!SUPABASE_ANON_KEY) {
    throw new Error('Missing Supabase anon key. Add it in js/google-login.js')
  }
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin
    }
  })
  if (error) throw error
  return data
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

function userInitials(user) {
  const meta = user?.user_metadata || {}
  const given = String(meta.given_name || meta.first_name || '').trim()
  const family = String(meta.family_name || meta.last_name || '').trim()
  if (given && family) return `${given[0]}${family[0]}`.toUpperCase()
  const name = meta.full_name || meta.name || ''
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
  }
  if (parts[0]?.length) return parts[0].slice(0, 2).toUpperCase()
  const email = user?.email || 'U'
  return email.slice(0, 2).toUpperCase()
}

export function mountGoogleLogin(root) {
  if (!root) return

  let currentSession = null
  let isPremium = false
  let menuOpen = false

  const render = (session = currentSession) => {
    currentSession = session
    const user = session?.user
    if (user) {
      const name = user.user_metadata?.full_name || user.user_metadata?.name || user.email || 'Signed in'
      const initials = userInitials(user)
      root.innerHTML = `
        <div class="relative">
          <button type="button" id="account-menu-btn" aria-expanded="${menuOpen}" aria-haspopup="true"
            title="${escapeHtml(name)}"
            class="h-9 w-9 rounded-full bg-zinc-900 text-white text-[12px] font-semibold grid place-items-center ring-1 ring-zinc-200 hover:bg-zinc-800 transition">
            ${escapeHtml(initials)}
          </button>
          <div id="account-menu" class="${menuOpen ? '' : 'hidden'} absolute right-0 top-11 z-40 w-44 rounded-xl bg-white p-1.5 shadow-card ring-1 ring-zinc-200">
            ${isPremium
              ? `<p class="px-3 py-2 text-[12px] font-medium text-emerald-700">Premium</p>`
              : `<button type="button" id="account-upgrade-btn" class="w-full rounded-lg px-3 py-2 text-left text-[13px] font-medium text-zinc-800 hover:bg-zinc-50">Upgrade</button>`}
            <button type="button" id="google-signout-btn" class="w-full rounded-lg px-3 py-2 text-left text-[13px] font-medium text-zinc-800 hover:bg-zinc-50">Sign out</button>
          </div>
        </div>`
      root.querySelector('#account-menu-btn')?.addEventListener('click', (event) => {
        event.stopPropagation()
        menuOpen = !menuOpen
        render()
      })
      root.querySelector('#account-upgrade-btn')?.addEventListener('click', () => {
        menuOpen = false
        render()
        window.dispatchEvent(new Event('sm-upgrade-click'))
      })
      root.querySelector('#google-signout-btn')?.addEventListener('click', async () => {
        menuOpen = false
        await signOut()
        render(null)
      })
      return
    }

    root.innerHTML = `
      <button type="button" id="google-login-btn"
        class="inline-flex items-center gap-2 h-9 rounded-lg bg-white px-3 text-[13px] font-medium text-zinc-800 ring-1 ring-zinc-200 hover:bg-zinc-50 hover:ring-zinc-300 transition shadow-sm">
        <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
          <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>
          <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.33A9 9 0 0 0 9 18z"/>
          <path fill="#FBBC05" d="M3.97 10.71A5.41 5.41 0 0 1 3.69 9c0-.59.1-1.17.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.04l3.01-2.33z"/>
          <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>
        </svg>
        Continue with Google
      </button>`

    root.querySelector('#google-login-btn')?.addEventListener('click', async (event) => {
      const button = event.currentTarget
      button.disabled = true
      try {
        await signInWithGoogle()
      } catch (error) {
        console.error(error)
        button.disabled = false
      }
    })
  }

  supabase.auth.getSession().then(({ data }) => {
    render(data.session)
    window.dispatchEvent(new CustomEvent('sm-auth-change', { detail: { session: data.session } }))
  })
  supabase.auth.onAuthStateChange((_event, session) => {
    menuOpen = false
    render(session)
    window.dispatchEvent(new CustomEvent('sm-auth-change', { detail: { session } }))
  })
  window.addEventListener('sm-premium-change', (event) => {
    isPremium = Boolean(event.detail?.isPremium)
    render()
  })
  document.addEventListener('click', (event) => {
    if (!menuOpen || root.contains(event.target)) return
    menuOpen = false
    render()
  })
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
