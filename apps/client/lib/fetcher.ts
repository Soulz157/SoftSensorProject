import { getSession, signOut } from 'next-auth/react'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL

export async function fetchClient(endpoint: string, options: RequestInit = {}) {
  const session = await getSession()

  const headers = new Headers(options.headers)
  if (!headers.has('Content-Type')) {
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
