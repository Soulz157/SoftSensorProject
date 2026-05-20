import { DefaultSession } from 'next-auth'
import { JWT as DefaultJWT } from 'next-auth/jwt'

declare module 'next-auth/jwt' {
  interface JWT extends DefaultJWT {
    id: string
    accessToken: string
    refreshToken: string
    role: string
    email: string
    firstName: string
    lastName: string
    expiresAt: number
    error?: 'RefreshTokenExpired'
  }
}

declare module 'next-auth' {
  interface User {
    id: string
    role: string
    accessToken: string
    refreshToken: string
    firstName: string
    lastName: string
  }
  interface Session {
    user: {
      id: string
      email: string
      role: string
      accessToken: string
      firstName: string
      lastName: string
    } & DefaultSession['user']
    error?: 'RefreshTokenExpired'
  }
}
