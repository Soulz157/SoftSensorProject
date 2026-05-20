'use client'

import { useState } from 'react'
import Link from 'next/link'
import * as z from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Eye,
  EyeOff,
  Mail,
  Lock,
  User,
  Building2,
  ArrowRight,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useRegister } from '@/hooks/auth/use-register'

const formSchema = z
  .object({
    firstName: z.string().min(1, 'กรุณากรอกชื่อจริง'),
    lastName: z.string().min(1, 'กรุณากรอกนามสกุล'),
    email: z.string().email('รูปแบบอีเมลไม่ถูกต้อง'),
    company: z.string().min(1, 'กรุณากรอกชื่อบริษัท'),
    password: z
      .string()
      .min(8, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร')
      .regex(/[A-Z]/, 'รหัสผ่านต้องมีตัวอักษรพิมพ์ใหญ่')
      .regex(/[0-9]/, 'รหัสผ่านต้องมีตัวเลข'),
    confirmPassword: z.string().min(1, 'กรุณายืนยันรหัสผ่าน'),
  })
  .refine(data => data.password === data.confirmPassword, {
    message: 'รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน',
    path: ['confirmPassword'],
  })

export function RegisterForm() {
  const { register, isLoading } = useRegister()
  const [showPassword, setShowPassword] = useState(false)

  const formData = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      password: '',
      confirmPassword: '',
      company: '',
    },
  })

  const passwordRequirements = [
    { label: '8+ chars', met: formData.watch('password').length >= 8 },
    { label: 'Uppercase', met: /[A-Z]/.test(formData.watch('password')) },
    { label: 'Number', met: /[0-9]/.test(formData.watch('password')) },
  ]

  const handleSubmit = async (values: z.infer<typeof formSchema>) => {
    await register(values)
  }

  return (
    <>
      <form
        onSubmit={formData.handleSubmit(handleSubmit)}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              First Name
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="John"
                {...formData.register('firstName')}
                className="pl-10 h-11 bg-secondary/50 border-border focus:bg-background transition-colors"
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Last Name
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Doe"
                {...formData.register('lastName')}
                className="pl-10 h-11 bg-secondary/50 border-border focus:bg-background transition-colors"
                required
              />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Work Email
          </label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="email"
              placeholder="name@company.com"
              {...formData.register('email')}
              className="pl-10 h-11 bg-secondary/50 border-border focus:bg-background transition-colors"
              required
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Company Name
          </label>
          <div className="relative">
            <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Acme Inc."
              {...formData.register('company')}
              className="pl-10 h-11 bg-secondary/50 border-border focus:bg-background transition-colors"
              required
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Password
          </label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type={showPassword ? 'text' : 'password'}
              placeholder="Create a strong password"
              {...formData.register('password')}
              className="pl-10 pr-10 h-11 bg-secondary/50 border-border focus:bg-background transition-colors"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
          {formData.watch('password') && (
            <div className="flex gap-3 pt-1">
              {passwordRequirements.map((req, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-1.5 text-xs ${
                    req.met ? 'text-primary' : 'text-muted-foreground'
                  }`}
                >
                  <div
                    className={`h-1.5 w-1.5 rounded-full ${
                      req.met ? 'bg-primary' : 'bg-muted-foreground/50'
                    }`}
                  />
                  {req.label}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Confirm Password
          </label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="password"
              placeholder="Confirm your password"
              {...formData.register('confirmPassword')}
              className="pl-10 pr-10 h-11 bg-secondary/50 border-border focus:bg-background transition-colors"
              required
            />
          </div>
          {formData.formState.errors.confirmPassword && (
            <p className="text-xs text-destructive">
              {formData.formState.errors.confirmPassword.message}
            </p>
          )}
        </div>

        <Button
          type="submit"
          className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-all mt-2"
          disabled={isLoading}
        >
          {isLoading ? (
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
              Creating account...
            </div>
          ) : (
            <div className="flex items-center gap-2">
              Create account
              <ArrowRight className="h-4 w-4" />
            </div>
          )}
        </Button>
      </form>

      <p className="text-center text-xs text-muted-foreground mt-4">
        By creating an account, you agree to our{' '}
        <Link
          href="#"
          className="text-primary hover:text-primary/80 transition-colors"
        >
          Terms
        </Link>{' '}
        and{' '}
        <Link
          href="#"
          className="text-primary hover:text-primary/80 transition-colors"
        >
          Privacy Policy
        </Link>
      </p>
    </>
  )
}
