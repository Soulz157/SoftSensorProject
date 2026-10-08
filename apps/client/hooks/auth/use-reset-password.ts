'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import { authService } from '@/services/auth'

export const useResetPassword = () => {
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)

  const forgotPassword = async (email: string) => {
    setIsLoading(true)
    try {
      await authService.forgotPassword(email)
      setIsSubmitted(true)
    } catch (error) {
      toast.error("Couldn't send the reset link", {
        description:
          error instanceof Error
            ? error.message
            : 'Check your connection and try again.',
      })
    } finally {
      setIsLoading(false)
    }
  }

  return { forgotPassword, isLoading, isSubmitted, setIsSubmitted }
}
