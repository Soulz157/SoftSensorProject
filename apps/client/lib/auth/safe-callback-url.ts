/**
 * DS-LAKE-037-D05. Where to send a user after they sign in again.
 *
 * `callbackUrl` arrives in a URL anyone can craft, so honouring it blindly is
 * an open redirect (`/login?callbackUrl=https://evil`). Only a same-origin
 * RELATIVE path is accepted; anything else returns null and the caller falls
 * back to its default. Auth pages are refused too - returning to `/login` after
 * logging in would loop.
 *
 * Pure and free of next-auth imports so the edge `proxy.ts` and client
 * components can share it.
 */
const AUTH_PREFIXES = ['/login', '/register', '/reset-password']
const PROBE_ORIGIN = 'http://callback.invalid'

export function safeCallbackUrl(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith('/')) return null
  // `//host` and `/\host` are scheme-relative to a browser; control characters
  // and backslashes are how a path gets smuggled past a prefix check.
  if (raw.startsWith('//') || raw.startsWith('/\\')) return null
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null

  let url: URL
  try {
    url = new URL(raw, PROBE_ORIGIN)
  } catch {
    return null
  }
  if (url.origin !== PROBE_ORIGIN) return null
  if (
    AUTH_PREFIXES.some(
      p => url.pathname === p || url.pathname.startsWith(`${p}/`),
    )
  ) {
    return null
  }
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * The `/login` URL that remembers `path` (pathname + search). An auth page
 * maps to a bare `/login`, since there is nothing worth coming back to.
 */
export function loginUrlWithCallback(path: string): string {
  const safe = safeCallbackUrl(path)
  return safe ? `/login?callbackUrl=${encodeURIComponent(safe)}` : '/login'
}
