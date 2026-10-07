'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { authService } from '@/services/auth'

export const useChangePassword = () => {
  const [isLoading, setIsLoading] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const router = useRouter()

  const changePassword = async (data: {
    currentPassword: string
    newPassword: string
    confirmPassword: string
  }) => {
    setIsLoading(true)
    try {
      await authService.changePassword(data)
      setIsSuccess(true)
      toast.success('Password updated')
    } catch (error) {
      toast.error("Couldn't update your password", {
        description:
          error instanceof Error
            ? error.message
            : 'Check your connection and try again.',
      })
    } finally {
      setIsLoading(false)
    }
  }

  return { changePassword, isLoading, isSuccess, router }
}
