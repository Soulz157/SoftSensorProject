import NextAuth, { type NextAuthConfig, type NextAuthResult } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
// import GoogleProvider from 'next-auth/providers/google'
// import MicrosoftEntraId from 'next-auth/providers/microsoft-entra-id'
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

export const authConfig: NextAuthConfig = {
  providers: [
    // GoogleProvider({
    //   clientId: process.env.GOOGLE_CLIENT_ID!,
    //   clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    // }),
    // MicrosoftEntraId({
    //   clientId: process.env.MICROSOFT_CLIENT_ID!,
    //   clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
    // }),
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

          const user = await res.json()

          if (!res.ok) {
            throw new Error(user.message || 'อีเมลหรือรหัสผ่านไม่ถูกต้อง')
          }

          const accessToken = user.data?.accessToken ?? user.accessToken
          if (accessToken) {
            const decoded: DecodedToken = jwtDecode(accessToken)

            return {
              id: decoded.id,
              role: decoded.role,
              email: decoded.email,
              firstName: decoded.firstName ?? '',
              lastName: decoded.lastName ?? '',
              accessToken,
            }
          }
          return null
        } catch (error) {
          if (error instanceof Error) {
            throw new Error(error.message)
          }
          throw new Error('เกิดข้อผิดพลาดในการเชื่อมต่อ')
        }
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (
        account?.provider === 'google' ||
        account?.provider === 'microsoft-entra-id'
      ) {
        const provider =
          account.provider === 'microsoft-entra-id' ? 'microsoft' : 'google'
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/api/v1/public/auth/oauth`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              provider,
              providerAccountId: account.providerAccountId,
              email: user.email,
              name: user.name,
              accessToken: account.access_token,
              refreshToken: account.refresh_token,
              expiresAt: account.expires_at,
            }),
          },
        )
        if (!res.ok) return false
        const body = await res.json()
        const backendToken: string = body.accessToken
        const decoded = jwtDecode<DecodedToken>(backendToken)
        user.id = decoded.id
        user.role = decoded.role
        user.accessToken = backendToken
      }
      return true
    },
    async jwt({ token, user }) {
      if (user) {
        token.accessToken = user.accessToken
        token.id = user.id
        token.role = user.role
        token.firstName = user.firstName
        token.lastName = user.lastName
      }
      return token
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string
        session.user.email = token.email as string
        session.user.firstName = token.firstName as string
        session.user.lastName = token.lastName as string
        session.user.role = token.role as string
        session.user.accessToken = token.accessToken as string
      }
      return session
    },
  },
  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60,
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
