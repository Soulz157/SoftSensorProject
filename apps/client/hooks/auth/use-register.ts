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

      toast.success('Account created! Please sign in.')

      toast.success('เข้าสู่ระบบสำเร็จ')

      const result = await signIn('credentials', {
        email: data.email,
        password: data.password,
        redirect: false,
      })

      if (!result) {
        toast.error('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง')
        return
      }

      if (result.error) {
        toast.error('สมัครสมาชิกสำเร็จ')
        router.push('/login')
      } else {
        toast.success('เข้าสู่ระบบสำเร็จ')
        router.push('/dashboard')
      }
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

  return { register, isLoading }
}
