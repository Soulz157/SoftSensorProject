'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { toast } from 'sonner'
import * as z from 'zod'

export const loginSchema = z.object({
  email: z.string().email('รูปแบบอีเมลไม่ถูกต้อง'),
  password: z.string().min(1, 'กรุณากรอกรหัสผ่าน'),
})

export type LoginFormValues = z.infer<typeof loginSchema>

export const useAuth = () => {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)

  const login = async (values: LoginFormValues) => {
    setIsLoading(true)

    try {
      const res = await signIn('credentials', {
        email: values.email,
        password: values.password,
        redirect: false,
      })

      if (res?.error) {
        toast.error('เข้าสู่ระบบไม่สำเร็จ', {
          description: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง',
        })
      } else {
        toast.success('เข้าสู่ระบบสำเร็จ')
        router.push('/dashboard')
        router.refresh()
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

  return { login, isLoading }
}
