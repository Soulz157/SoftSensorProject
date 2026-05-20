import NextAuth, { type NextAuthConfig, type NextAuthResult } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { jwtDecode } from 'jwt-decode'

interface DecodedToken {
  id: string
  email: string
  role: string
  exp: number
  firstName: string
  lastName: string
  company?: string
}

function parseRefreshTokenFromCookie(setCookieHeader: string | null): string {
  if (!setCookieHeader) return ''
  return setCookieHeader.match(/refresh_token=([^;]+)/)?.[1] ?? ''
}

export const authConfig: NextAuthConfig = {
  secret: process.env.NEXTAUTH_SECRET,
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        try {
          const API_URL = process.env.NEXT_PUBLIC_API_URL

          const res = await fetch(`${API_URL}/api/v1/public/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: credentials.email,
              password: credentials.password,
            }),
          })

          const body = await res.json()

          if (!res.ok) {
            throw new Error(body.message || 'อีเมลหรือรหัสผ่านไม่ถูกต้อง')
          }

          const accessToken: string = body.data?.accessToken ?? body.accessToken
          if (!accessToken) return null

          const decoded: DecodedToken = jwtDecode(accessToken)
          const refreshToken = parseRefreshTokenFromCookie(
            res.headers.get('set-cookie'),
          )

          return {
            id: decoded.id,
            role: decoded.role,
            email: decoded.email,
            firstName: decoded.firstName ?? '',
            lastName: decoded.lastName ?? '',
            accessToken,
            refreshToken,
          }
        } catch (error) {
          if (error instanceof Error) throw new Error(error.message)
          throw new Error('เกิดข้อผิดพลาดในการเชื่อมต่อ')
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const decoded: DecodedToken = jwtDecode(user.accessToken)
        return {
          ...token,
          id: user.id,
          role: user.role,
          firstName: user.firstName,
          lastName: user.lastName,
          accessToken: user.accessToken,
          refreshToken: user.refreshToken,
          expiresAt: decoded.exp * 1000,
        }
      }

      if (Date.now() < token.expiresAt - 60_000) return token

      try {
        const API_URL = process.env.NEXT_PUBLIC_API_URL
        const res = await fetch(`${API_URL}/api/v1/authorized/auth/refresh`, {
          method: 'POST',
          headers: {
            Cookie: `refresh_token=${token.refreshToken}`,
          },
        })

        if (!res.ok) throw new Error('Refresh failed')

        const body = await res.json()
        const newAccessToken: string =
          body.data?.accessToken ?? body.accessToken
        const newRefreshToken =
          parseRefreshTokenFromCookie(res.headers.get('set-cookie')) ||
          token.refreshToken
        const decoded: DecodedToken = jwtDecode(newAccessToken)

        return {
          ...token,
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          expiresAt: decoded.exp * 1000,
          error: undefined,
        }
      } catch {
        return { ...token, error: 'RefreshTokenExpired' as const }
      }
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id
        session.user.email = token.email
        session.user.firstName = token.firstName
        session.user.lastName = token.lastName
        session.user.role = token.role
        session.user.accessToken = token.accessToken
      }
      session.error = token.error
      return session
    },
  },
  session: {
    strategy: 'jwt',
    maxAge: 7 * 24 * 60 * 60,
  },
  pages: {
    signIn: '/login',
  },
}

const nextAuth = NextAuth(authConfig)

export const handlers: NextAuthResult['handlers'] = nextAuth.handlers
export const signIn: NextAuthResult['signIn'] = nextAuth.signIn
export const signOut: NextAuthResult['signOut'] = nextAuth.signOut
export const auth: NextAuthResult['auth'] = nextAuth.auth
