'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { toast } from 'sonner'
import { authService } from '@/services/auth'
import { RegisterPayload } from '@/types'

export const useRegister = () => {
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const register = async (data: RegisterPayload) => {
    setIsLoading(true)
    try {
      await authService.register(data)

      // The account exists from here on; signing in is a convenience.
      const result = await signIn('credentials', {
        email: data.email,
        password: data.password,
        redirect: false,
      })

      if (!result || result.error) {
        toast.success('Account created', {
          description: 'Sign in to continue.',
        })
        router.push('/login')
      } else {
        toast.success('Account created')
        router.push('/')
      }
    } catch (error) {
      toast.error("Couldn't create your account", {
        description:
          error instanceof Error
            ? error.message
            : 'Check your connection and try again.',
      })
    } finally {
      setIsLoading(false)
    }
  }

  return { register, isLoading }
}
