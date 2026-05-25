'use client'

import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import Link from 'next/link'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useChangePassword } from '@/hooks/auth/use-change-password'
import {
  Eye,
  EyeOff,
  Lock,
  KeyRound,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Check,
  X,
} from 'lucide-react'
import { useState } from 'react'

const formSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
      .regex(/[0-9]/, 'Must contain at least one number')
      .regex(/[^A-Za-z0-9]/, 'Must contain at least one special character'),
    confirmPassword: z.string(),
  })
  .refine(data => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine(data => data.currentPassword !== data.newPassword, {
    message: 'New password must be different from current password',
    path: ['newPassword'],
  })

type FormValues = z.infer<typeof formSchema>

export default function ChangePasswordPage() {
  const { changePassword, isLoading, isSuccess, router } = useChangePassword()

  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const {
    register,
    handleSubmit,
    control,
    formState: { isValid },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: 'onChange',
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  })

  const watchNewPassword = useWatch({ control, name: 'newPassword' })

  const checks = {
    len: watchNewPassword.length >= 8,
    upper: /[A-Z]/.test(watchNewPassword),
    num: /[0-9]/.test(watchNewPassword),
    sym: /[^A-Za-z0-9]/.test(watchNewPassword),
  }
  const strength = Object.values(checks).filter(Boolean).length
  const strengthBarColor =
    strength === 4
      ? 'bg-primary'
      : strength >= 2
        ? 'bg-amber-400'
        : 'bg-destructive'

  const checkLabels = [
    { key: 'len', label: '8+ characters' },
    { key: 'upper', label: 'Uppercase' },
    { key: 'num', label: 'Number' },
    { key: 'sym', label: 'Symbol' },
  ] as const

  const onSubmit = async (data: FormValues) => {
    await changePassword({
      currentPassword: data.currentPassword,
      newPassword: data.newPassword,
      confirmPassword: data.confirmPassword,
    })
  }

  if (isSuccess) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md space-y-8">
          <div className="flex flex-col items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
              <CheckCircle2 className="h-6 w-6 text-primary-foreground" />
            </div>
            <div className="text-center">
              <h1 className="text-2xl font-semibold text-foreground">
                Password updated!
              </h1>
              <p className="mt-1 text-muted-foreground">
                Your password has been changed successfully.
              </p>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <Button
              className="w-full h-11"
              onClick={() => router.push('/settings')}
            >
              <div className="flex items-center gap-2">
                Back to settings
                <ArrowRight className="h-4 w-4" />
              </div>
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <KeyRound className="h-6 w-6 text-primary-foreground" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-semibold text-foreground">
              Change password
            </h1>
            <p className="mt-1 text-muted-foreground">
              Update your account password to keep it secure.
            </p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-5"
        >
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Current password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type={showCurrent ? 'text' : 'password'}
                {...register('currentPassword')}
                placeholder="Enter current password"
                className="pl-10 pr-10 h-11 bg-secondary/50 border-border focus:bg-background transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowCurrent(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showCurrent ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              New password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type={showNew ? 'text' : 'password'}
                {...register('newPassword')}
                placeholder="Enter new password"
                className="pl-10 pr-10 h-11 bg-secondary/50 border-border focus:bg-background transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowNew(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showNew ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {watchNewPassword && (
            <div className="space-y-2">
              <div className="flex gap-1">
                {[0, 1, 2, 3].map(i => (
                  <div
                    key={i}
                    className={`h-1.5 flex-1 rounded-full transition-colors ${i < strength ? strengthBarColor : 'bg-muted'}`}
                  />
                ))}
              </div>
              <div className="grid grid-cols-2 gap-1">
                {checkLabels.map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-1.5">
                    {checks[key] ? (
                      <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                    ) : (
                      <X className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    <span
                      className={`text-xs ${checks[key] ? 'text-primary' : 'text-muted-foreground'}`}
                    >
                      {label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Confirm new password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type={showConfirm ? 'text' : 'password'}
                {...register('confirmPassword')}
                placeholder="Re-enter new password"
                className="pl-10 pr-10 h-11 bg-secondary/50 border-border focus:bg-background transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showConfirm ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <Button
            type="submit"
            className="w-full h-11"
            disabled={!isValid || isLoading}
          >
            {isLoading ? (
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                Updating...
              </div>
            ) : (
              <div className="flex items-center gap-2">
                Update password
                <ArrowRight className="h-4 w-4" />
              </div>
            )}
          </Button>
        </form>

        <div className="flex items-center justify-center">
          <Link
            href="/settings"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to settings
          </Link>
        </div>
      </div>
    </div>
  )
}
