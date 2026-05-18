'use client'
import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { toast } from 'sonner'

export type RegisterData = {
  email: string
  password: string
  username?: string
}

export const useRegister = () => {
  const [isLoading, setIsLoading] = useState(false)

  const register = async (data: RegisterData): Promise<boolean> => {
    setIsLoading(true)
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/v1/public/auth/register`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
      )
      if (!res.ok) {
        const err = (await res.json()) as { message?: string }
        toast.error(err.message ?? 'Registration failed')
        return false
      }
      const result = await signIn('credentials', { ...data, redirect: false })
      if (result?.error) {
        toast.error('Account created. Please sign in.')
        return false
      }
      toast.success('Account created!')
      return true
    } catch {
      toast.error('Something went wrong.')
      return false
    } finally {
      setIsLoading(false)
    }
  }

  return { register, isLoading }
}
