import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const AUTH_PATHS = [
  '/login',
  '/register',
  '/reset-password',
  '/change-password',
]

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
    const loginUrl = new URL('/login', req.nextUrl)
    loginUrl.searchParams.set('callbackUrl', path)
    return NextResponse.redirect(loginUrl)
  }

  if (isLoggedIn && !hasError && isAuthPath) {
    const home = role === 'ADMIN' ? '/admin' : '/dashboard'
    return NextResponse.redirect(new URL(home, req.nextUrl))
  }

  if (
    isLoggedIn &&
    !hasError &&
    path.startsWith('/admin') &&
    role !== 'ADMIN'
  ) {
    return NextResponse.redirect(new URL('/dashboard', req.nextUrl))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
