import { getSession, signOut } from 'next-auth/react'

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

export async function fetchClient(endpoint: string, options: RequestInit = {}) {
  const session = await sharedSession()

  const headers = new Headers(options.headers)
  // Only advertise a JSON body when one is actually sent. Fastify rejects a
  // bodyless request (e.g. DELETE) that carries `Content-Type: application/json`
  // with "Body cannot be empty when content-type is set to 'application/json'".
  if (options.body != null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  if (session?.user?.accessToken) {
    headers.set('Authorization', `Bearer ${session.user.accessToken}`)
  }

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers,
  })

  if (response.status === 401) {
    signOut({ callbackUrl: '/login' })
    throw new Error('Session expired')
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.message || `API Error: ${response.status}`)
  }

  return response.json()
}
