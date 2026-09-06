import { supabase } from './google-login.js'
import { getGuestId, getSessionUser } from './freemium.js'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function dateKey(value) {
  if (!value) return ''
  if (value instanceof Date) {
    if (value.getUTCHours() === 0 && value.getUTCMinutes() === 0 && value.getUTCSeconds() === 0) {
      return value.toISOString().slice(0, 10)
    }
    return localFromDate(value)
  }
  const match = String(value).match(/(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : ''
}

function localFromDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function localISODate(value = new Date()) {
  return dateKey(value) || dateKey(new Date())
}

export function postDate(post) {
  return dateKey(post?.scheduled_date) || dateKey(post?.created_at)
}

export async function listMyPosts() {
  const user = await getSessionUser()
  if (!user) {
    const error = new Error('Sign in to see your calendar')
    error.code = 'signin_required'
    return { user: null, posts: [], error }
  }
  const { data, error } = await supabase.rpc('list_my_posts')
  if (error) {
    const { data: rows, error: tableError } = await supabase
      .from('posts')
      .select('id, platform, content, scheduled_date, created_at, watermarked')
      .eq('user_id', user.id)
      .order('scheduled_date', { ascending: false })
    if (tableError) throw new Error(tableError.message || error.message)
    return { user, posts: extractPosts(rows) }
  }
  if (data?.error === 'signin_required') {
    const denied = new Error('Sign in to see your calendar')
    denied.code = 'signin_required'
    return { user: null, posts: [], error: denied }
  }
  return { user, posts: extractPosts(data) }
}

export async function saveStudioPost({ platform, content, scheduledDate, postId }) {
  const user = await getSessionUser()
  const date = scheduledDate || localISODate()
  if (postId && user) {
    const { data, error } = await supabase.rpc('update_post', {
      p_id: postId,
      p_platform: platform,
      p_content: content || '',
      p_scheduled_date: date
    })
    if (!error && data?.ok !== false) {
      return { updated: true, post: data.post, user }
    }
  }
  const { data, error } = await supabase.rpc('create_post', {
    p_guest_id: getGuestId(),
    p_platform: platform,
    p_content: content || '',
    p_scheduled_date: date
  })
  if (error) {
    const fallback = await supabase.rpc('create_post', {
      p_guest_id: getGuestId(),
      p_platform: platform,
      p_content: content || ''
    })
    if (fallback.error) throw new Error(fallback.error.message)
    return { updated: false, usage: fallback.data, user }
  }
  return { updated: false, usage: data, user }
}

export function mountCalendar(root, options) {
  if (!root) return { refresh() {}, setDate() {}, ensurePost() {} }

  let cursor = startOfMonth(dateKey(options.getDate?.()) || localISODate())
  let selected = dateKey(options.getDate?.()) || localISODate()
  let posts = []
  let status = { loading: false, error: '', signedIn: false }

  const render = () => {
    const byDate = groupByDate(posts)
    const days = buildMonthDays(cursor)
    const selectedPosts = byDate[selected] || []
    root.innerHTML = `
      <div class="flex items-center justify-between gap-3 mb-3">
        <button type="button" data-cal="prev" class="h-9 w-9 rounded-lg ring-1 ring-zinc-200 text-zinc-600 hover:bg-zinc-50">‹</button>
        <p class="text-[14px] font-semibold tracking-tight">${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}</p>
        <button type="button" data-cal="next" class="h-9 w-9 rounded-lg ring-1 ring-zinc-200 text-zinc-600 hover:bg-zinc-50">›</button>
      </div>
      <div class="grid grid-cols-7 gap-1 mb-1">
        ${WEEKDAYS.map((day) => `<div class="text-center text-[10px] uppercase tracking-wide text-zinc-400 py-1">${day}</div>`).join('')}
      </div>
      <div class="grid grid-cols-7 gap-1">
        ${days.map((day) => {
          if (!day) return '<div></div>'
          const iso = dateKey(day)
          const count = (byDate[iso] || []).length
          const isSelected = iso === selected
          const isToday = iso === localISODate()
          const hasPosts = count > 0
          return `
            <button type="button" data-cal-day="${iso}"
              class="relative min-h-[44px] rounded-lg px-1 py-1 text-[12px] ${
                isSelected
                  ? 'bg-blue-600 text-white'
                  : hasPosts
                    ? 'bg-white text-zinc-800 ring-1 ring-zinc-300 font-medium'
                    : isToday
                      ? 'text-blue-700'
                      : 'text-zinc-500 hover:bg-white/70'
              }">
              ${day.getDate()}
              ${hasPosts ? `<span class="absolute bottom-1 left-1/2 -translate-x-1/2 flex gap-0.5">${dotMarkup(byDate[iso], isSelected)}</span>` : ''}
            </button>`
        }).join('')}
      </div>
      <div class="mt-4 space-y-2">
        <div class="flex items-center justify-between gap-2">
          <p class="text-[13px] font-medium text-zinc-800">Posts on ${selected}</p>
          ${status.loading ? '<p class="text-[12px] text-zinc-500">Loading…</p>' : ''}
        </div>
        ${!status.signedIn ? `<p class="rounded-xl bg-zinc-50 ring-1 ring-zinc-200 px-3 py-3 text-[13px] text-zinc-600">Sign in with Google to save posts to your calendar and edit them later.</p>` : ''}
        ${status.error ? `<p class="rounded-xl bg-rose-50 ring-1 ring-rose-200 px-3 py-3 text-[13px] text-rose-700">${escapeHtml(status.error)}</p>` : ''}
        ${status.signedIn && !status.loading && !selectedPosts.length ? `<p class="text-[13px] text-zinc-500">No posts scheduled for this day. Pick this date and save a mockup.</p>` : ''}
        ${selectedPosts.map((post) => `
          <article class="rounded-xl bg-white ring-1 ring-zinc-200 px-3 py-3">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">${escapeHtml(post.platform || 'post')}</p>
                <p class="mt-1 text-[13px] text-zinc-800 line-clamp-3">${escapeHtml(post.content || 'Untitled post')}</p>
              </div>
              <div class="flex shrink-0 gap-1.5">
                <button type="button" data-cal-view="${post.id}" class="h-8 rounded-lg px-2.5 text-[12px] font-medium text-zinc-600 ring-1 ring-zinc-200 hover:bg-zinc-50">View</button>
                <button type="button" data-cal-edit="${post.id}" class="h-8 rounded-lg px-2.5 text-[12px] font-medium text-blue-700 ring-1 ring-blue-200 hover:bg-blue-50">Edit</button>
              </div>
            </div>
          </article>
        `).join('')}
      </div>`

    root.querySelector('[data-cal="prev"]')?.addEventListener('click', () => {
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1)
      render()
    })
    root.querySelector('[data-cal="next"]')?.addEventListener('click', () => {
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
      render()
    })
    root.querySelectorAll('[data-cal-day]').forEach((button) => {
      button.addEventListener('click', () => {
        selected = dateKey(button.dataset.calDay)
        options.onSelectDate?.(selected)
        render()
      })
    })
    root.querySelectorAll('[data-cal-view], [data-cal-edit]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.calView || button.dataset.calEdit
        const post = posts.find((item) => String(item.id) === String(id))
        if (post) options.onOpenPost?.(post, Boolean(button.dataset.calEdit))
      })
    })
  }

  async function refresh() {
    status = { loading: true, error: '', signedIn: false }
    render()
    try {
      const result = await listMyPosts()
      posts = result.posts
      status = {
        loading: false,
        error: result.error && result.error.code !== 'signin_required' ? result.error.message : '',
        signedIn: Boolean(result.user)
      }
    } catch (error) {
      posts = []
      status = { loading: false, error: error.message || 'Could not load posts', signedIn: false }
    }
    render()
  }

  render()
  refresh()

  return {
    refresh,
    setDate(iso) {
      selected = dateKey(iso) || selected
      cursor = startOfMonth(selected)
      render()
    },
    ensurePost(post) {
      if (!post) return
      const key = postDate(post)
      if (post.id) {
        const existing = posts.find((item) => String(item.id) === String(post.id))
        const merged = { ...existing, ...post }
        posts = posts.filter((item) => String(item.id) !== String(post.id)).concat(merged)
      }
      if (key) {
        selected = key
        cursor = startOfMonth(key)
      }
      render()
    }
  }
}

function extractPosts(value) {
  let data = value
  if (typeof data === 'string') {
    try { data = JSON.parse(data) } catch { return [] }
  }
  if (!data) return []
  if (Array.isArray(data)) {
    if (data[0] && (Array.isArray(data[0].posts) || data[0].ok !== undefined)) {
      return extractPosts(data[0])
    }
    return data.map(normalizePost)
  }
  if (Array.isArray(data.posts) || typeof data.posts === 'string') {
    return extractPosts(data.posts)
  }
  return []
}

function normalizePost(post) {
  if (!post || typeof post !== 'object') return post
  return {
    ...post,
    scheduled_date: dateKey(post.scheduled_date) || post.scheduled_date
  }
}

function startOfMonth(iso) {
  const key = dateKey(iso) || localISODate()
  const date = new Date(`${key}T00:00:00`)
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function buildMonthDays(cursor) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)
  const days = Array(first.getDay()).fill(null)
  for (let day = 1; day <= last.getDate(); day += 1) {
    days.push(new Date(cursor.getFullYear(), cursor.getMonth(), day))
  }
  return days
}

function groupByDate(posts) {
  return posts.reduce((map, post) => {
    const key = postDate(post)
    if (!key) return map
    map[key] = map[key] || []
    map[key].push(post)
    return map
  }, {})
}

function dotMarkup(dayPosts, selected) {
  const platforms = [...new Set((dayPosts || []).map((post) => post.platform))].slice(0, 3)
  return platforms.map((platform) => {
    const color = platform === 'linkedin' ? '#0A66C2' : platform === 'x' ? (selected ? '#fff' : '#111') : '#e1306c'
    return `<span class="h-1.5 w-1.5 rounded-full" style="background:${color}"></span>`
  }).join('')
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
