import { getSession, signOut } from 'next-auth/react'
import { loginUrlWithCallback } from '@/lib/auth/safe-callback-url'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL

// Dedup concurrent getSession() calls: a Promise.all burst of fetchClient calls
// shares one /api/auth/session round-trip. Cleared once settled so later calls
// refetch at the normal cadence (never blocks next-auth silent refresh).
let inFlightSession: ReturnType<typeof getSession> | null = null
function sharedSession() {
  if (!inFlightSession) {
    inFlightSession = getSession()
    inFlightSession.finally(() => {
      inFlightSession = null
    })
  }
  return inFlightSession
}

/**
 * An API error that still knows its HTTP status.
 *
 * `fetchClient` used to throw a bare `Error`, which flattened every failure
 * into a message string — so a caller could not tell "the thing you asked for
 * is permanently gone" from "the server was briefly unhappy" without matching
 * on prose. DS-LAKE-025 needs exactly that distinction: a 404 from the API
 * means a dataset's stored bytes have been reclaimed and the only way forward
 * is re-fetching from the source, which is an offer the UI has to make rather
 * than a message it can print.
 *
 * Still an `Error` with the same `message`, so every existing
 * `err instanceof Error ? err.message : …` catch keeps behaving identically.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function sendAs(
  endpoint: string,
  options: RequestInit,
  accessToken: string | undefined,
) {
  const headers = new Headers(options.headers)
  // Only advertise a JSON body when one is actually sent. Fastify rejects a
  // bodyless request (e.g. DELETE) that carries `Content-Type: application/json`
  // with "Body cannot be empty when content-type is set to 'application/json'".
  if (options.body != null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
  return fetch(`${BASE_URL}${endpoint}`, { ...options, headers })
}

function signOutToLogin() {
  // DS-LAKE-037: remember where the user was so signing in again returns
  // them there (a half-built dataset wizard, say) instead of /overview.
  signOut({
    redirectTo:
      typeof window === 'undefined'
        ? '/auth/login'
        : loginUrlWithCallback(
            window.location.pathname + window.location.search,
          ),
  })
}

export async function fetchClient(endpoint: string, options: RequestInit = {}) {
  const session = await sharedSession()
  const sentToken = session?.user?.accessToken
  let response = await sendAs(endpoint, options, sentToken)

  // One 401 is not yet "signed out". The access token can expire, or be
  // refreshed by another request, while this one is in flight — a screen
  // polling a training run every 2.5 s meets that boundary every half hour.
  // Ask for the session again (which refreshes it if due) and, if that yields
  // a DIFFERENT token, try once more. Only a refused refresh, an unchanged
  // token, or a second 401 signs the user out.
  if (response.status === 401) {
    const fresh = await sharedSession()
    const freshToken = fresh?.user?.accessToken
    if (
      fresh?.error !== 'RefreshTokenExpired' &&
      freshToken &&
      freshToken !== sentToken
    ) {
      response = await sendAs(endpoint, options, freshToken)
    }
  }

  if (response.status === 401) {
    signOutToLogin()
    throw new Error('Session expired')
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new ApiError(
      errorData.message || `API Error: ${response.status}`,
      response.status,
    )
  }

  return response.json()
}
