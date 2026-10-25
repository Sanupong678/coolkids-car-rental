// Thin fetch wrapper. All server calls go through here so auth (httpOnly
// cookie), error shape and base URL are handled in one place. Components never
// call fetch directly; they use stores/services that call this.

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message ?? `Request failed (${status})`)
    this.status = status
    this.code = body?.error?.code ?? 'UNKNOWN'
    this.details = body?.error?.details
  }
}

const BASE = import.meta.env.VITE_API_BASE ?? '/api/v1'

export async function api(path, { method = 'GET', body, signal } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    signal,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 204) return null
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const err = new ApiError(res.status, data)
    // The server already cleared the dead cookie; the auth store signs this tab out.
    if (err.code === 'SESSION_EXPIRED') window.dispatchEvent(new Event('auth:expired'))
    throw err
  }
  return data
}

/** Full-page navigation URL for starting OAuth sign-in with `provider`. */
export const oauthSignInUrl = (provider, returnTo = window.location.pathname + window.location.search) =>
  `${BASE}/auth/${provider}?returnTo=${encodeURIComponent(returnTo)}`
export const googleSignInUrl = (returnTo) => oauthSignInUrl('google', returnTo)
