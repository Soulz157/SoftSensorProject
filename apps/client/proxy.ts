import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { safeCallbackUrl } from '@/lib/auth/safe-callback-url'

// Guest-only pages: a logged-in user is sent to /overview. `/auth/change-password`
// is deliberately NOT here — it asks for the current password and calls the
// JWT-guarded /authorized/auth/change-password, so it is a logged-in page and
// falls under the protected rule below (guests go to /auth/login?callbackUrl=…).
const AUTH_PATHS = ['/auth/login', '/auth/register', '/auth/reset-password']

const PUBLIC_PATHS = ['/', ...AUTH_PATHS]

export async function proxy(req: NextRequest) {
  const session = await auth()
  const isLoggedIn = !!session
  const hasError = session?.error === 'RefreshTokenExpired'
  const path = req.nextUrl.pathname
  const role = session?.user?.role
  const isPublic = PUBLIC_PATHS.some(
    p => path === p || path.startsWith(p + '/'),
  )
  const isAuthPath = AUTH_PATHS.some(
    p => path === p || path.startsWith(p + '/'),
  )

  if ((!isLoggedIn || hasError) && !isPublic) {
    const loginUrl = new URL('/auth/login', req.nextUrl)
    // Search included (DS-LAKE-037): `?draftId=` is what a resume needs.
    loginUrl.searchParams.set('callbackUrl', path + req.nextUrl.search)
    return NextResponse.redirect(loginUrl)
  }

  if (isLoggedIn && !hasError && isAuthPath) {
    // const home = role === 'ADMIN' ? '/admin' : '/dashboard'
    // Signing in again lands here too (login() refreshes /login), so this is
    // where the remembered page is honoured. safeCallbackUrl admits only a
    // same-origin relative path; anything else is the old /overview.
    const back = safeCallbackUrl(req.nextUrl.searchParams.get('callbackUrl'))
    return NextResponse.redirect(new URL(back ?? '/overview', req.nextUrl))
  }

  if (
    isLoggedIn &&
    !hasError &&
    path.startsWith('/admin') &&
    role !== 'ADMIN'
  ) {
    return NextResponse.redirect(new URL('/overview', req.nextUrl))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
