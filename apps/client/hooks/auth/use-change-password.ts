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
      toast.success('เปลี่ยนรหัสผ่านสำเร็จ')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'เกิดข้อผิดพลาด')
    } finally {
      setIsLoading(false)
    }
  }

  return { changePassword, isLoading, isSuccess, router }
}
