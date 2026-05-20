import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/', '/login', '/register', '/reset-password']

export async function middleware(req: NextRequest) {
  const session = await auth()
  const isLoggedIn = !!session
  const hasError = session?.error === 'RefreshTokenExpired'
  const path = req.nextUrl.pathname
  const isPublic = PUBLIC_PATHS.some(
    p => path === p || path.startsWith(p + '/'),
  )

  if (!isLoggedIn || hasError) {
    if (!isPublic) {
      const loginUrl = new URL('/login', req.nextUrl)
      loginUrl.searchParams.set('callbackUrl', path)
      return NextResponse.redirect(loginUrl)
    }
  }

  if (isLoggedIn && !hasError && isPublic && path !== '/') {
    return NextResponse.redirect(new URL('/dashboard', req.nextUrl))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
