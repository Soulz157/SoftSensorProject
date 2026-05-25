'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { signIn, signOut, useSession } from 'next-auth/react'
import { toast } from 'sonner'
import * as z from 'zod'

export const loginSchema = z.object({
  email: z.string().email('รูปแบบอีเมลไม่ถูกต้อง'),
  password: z.string().min(1, 'กรุณากรอกรหัสผ่าน'),
})

export type LoginFormValues = z.infer<typeof loginSchema>

export const useAuth = () => {
  const { data: session, status } = useSession({ required: false })
  const router = useRouter()

  const isLoading = status === 'loading'
  const isAuthenticated = status === 'authenticated'

  useEffect(() => {
    if (session?.error === 'RefreshTokenExpired') {
      toast.error('Session หมดอายุ', {
        description: 'กรุณาเข้าสู่ระบบใหม่อีกครั้ง',
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
        console.log('Login error:', res.error)
        toast.error('เข้าสู่ระบบไม่สำเร็จ', {
          description: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง',
        })
      } else {
        toast.success('เข้าสู่ระบบสำเร็จ')
        router.refresh()
      }
    } catch (error) {
      if (error instanceof Error) {
        toast.error(error.message)
      } else {
        toast.error('เกิดข้อผิดพลาดในการเชื่อมต่อ')
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
