const ANALYTICS_LIMIT = 255

function sanitize(data = {}) {
  const out = {}
  Object.entries(data).forEach(([key, value]) => {
    if (value == null || value === '') return
    if (typeof value === 'boolean' || typeof value === 'number') {
      out[key] = value
      return
    }
    out[key] = String(value).slice(0, ANALYTICS_LIMIT)
  })
  return out
}

export function logEvent(name, data = {}) {
  if (!name) return
  const analytics = sanitize(data)
  const payload = {
    event: name,
    at: new Date().toISOString(),
    path: typeof location !== 'undefined' ? location.pathname : '',
    ...analytics,
    message: data.message ? String(data.message).slice(0, 4000) : undefined
  }

  try {
    if (typeof window.vaTrack === 'function') window.vaTrack(name, analytics)
    else if (window.va) window.va('event', { name, data: analytics })
  } catch {
    /* analytics must never affect the studio */
  }

  try {
    fetch('/api/event-log', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(payload),
      keepalive: true,
      cache: 'no-store',
      redirect: 'error'
    }).catch(() => {})
  } catch {
    /* ignore */
  }
}

if (typeof window !== 'undefined') {
  window.logStudioEvent = logEvent
}
