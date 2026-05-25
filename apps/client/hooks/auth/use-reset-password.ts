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
      if (error instanceof Error) {
        toast.error(error.message)
      } else {
        toast.error('เกิดข้อผิดพลาดในการเชื่อมต่อ')
      }
    } finally {
      setIsLoading(false)
    }
  }

  return { forgotPassword, isLoading, isSubmitted, setIsSubmitted }
}
