'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { signIn, signOut, useSession } from 'next-auth/react'
import { toast } from 'sonner'
import type { LoginValues } from '@/lib/auth-schemas'

export type LoginFormValues = LoginValues

export const useAuth = () => {
  const { data: session, status } = useSession({ required: false })
  const router = useRouter()

  const isLoading = status === 'loading'
  const isAuthenticated = status === 'authenticated'

  useEffect(() => {
    if (session?.error === 'RefreshTokenExpired') {
      toast.error('Your session expired', {
        description: 'Sign in again to continue.',
      })
      signOut({ callbackUrl: '/login' })
    }
  }, [session?.error])

  const login = async (values: LoginFormValues) => {
    try {
      const res = await signIn('credentials', {
        email: values.email,
        password: values.password,
        redirect: false,
      })

      if (res?.error) {
        toast.error("Couldn't sign in", {
          description: 'Check your email and password, then try again.',
        })
      } else {
        toast.success('Signed in')
        router.refresh()
      }
    } catch (error) {
      if (error instanceof Error) {
        toast.error(error.message)
      } else {
        toast.error(
          "Couldn't reach the server. Check your connection and try again.",
        )
      }
    }
  }

  const logout = async () => {
    await signOut({ callbackUrl: '/login' })
  }

  return {
    user: session?.user ?? null,
    accessToken: session?.user?.accessToken ?? null,
    isLoading,
    isAuthenticated,
    login,
    logout,
  }
}
