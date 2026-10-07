import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Guest-only pages: a logged-in user is sent to /overview. `/change-password`
// is deliberately NOT here — it asks for the current password and calls the
// JWT-guarded /authorized/auth/change-password, so it is a logged-in page and
// falls under the protected rule below (guests go to /login?callbackUrl=…).
const AUTH_PATHS = ['/login', '/register', '/reset-password']

// TEMPORARY (landing redesign Phase A): visual-only design preview, no data.
// Remove together with app/design-preview before Phase B ships.
const PUBLIC_PATHS = ['/', '/design-preview', ...AUTH_PATHS]

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
    const loginUrl = new URL('/login', req.nextUrl)
    loginUrl.searchParams.set('callbackUrl', path)
    return NextResponse.redirect(loginUrl)
  }

  if (isLoggedIn && !hasError && isAuthPath) {
    // const home = role === 'ADMIN' ? '/admin' : '/dashboard'
    return NextResponse.redirect(new URL('/overview', req.nextUrl))
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
