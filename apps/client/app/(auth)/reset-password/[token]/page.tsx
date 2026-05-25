'use client'

import { useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import Link from 'next/link'
import { authService } from '@/services/auth'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
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

export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()

  const searchParams = useSearchParams()
  const email = searchParams.get('email')

  const [newPass, setNewPass] = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const checks = {
    len: newPass.length >= 8,
    upper: /[A-Z]/.test(newPass),
    num: /[0-9]/.test(newPass),
    sym: /[^A-Za-z0-9]/.test(newPass),
  }
  const strength = Object.values(checks).filter(Boolean).length
  const isValid = strength === 4 && newPass === confirmPass

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

  async function handleSubmit() {
    if (!email) {
      toast.error('ไม่พบอีเมล กรุณาลองใหม่อีกครั้ง')
      return
    }
    setLoading(true)
    try {
      await authService.resetPassword({ email, token, password: newPass })
      setSuccess(true)
    } catch (err) {
      if (err instanceof Error) {
        toast.error('การรีเซ็ตรหัสผ่านล้มเหลว กรุณาลองใหม่อีกครั้ง', {
          description: err.message,
        })
      }
    } finally {
      setLoading(false)
    }
  }

  if (success) {
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
                Your password has been reset successfully.
              </p>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <Button
              className="w-full h-11"
              onClick={() => router.push('/login')}
            >
              <div className="flex items-center gap-2">
                Go to login
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
              Set new password
            </h1>
            <p className="mt-1 text-muted-foreground">
              Choose a strong password for your account
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              New password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type={showNew ? 'text' : 'password'}
                placeholder="Enter new password"
                value={newPass}
                onChange={e => setNewPass(e.target.value)}
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

          {newPass && (
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
              Confirm password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type={showConfirm ? 'text' : 'password'}
                placeholder="Re-enter new password"
                value={confirmPass}
                onChange={e => setConfirmPass(e.target.value)}
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
            {confirmPass && (
              <p
                className={`text-xs ${newPass === confirmPass ? 'text-primary' : 'text-destructive'}`}
              >
                {newPass === confirmPass
                  ? 'Passwords match'
                  : 'Passwords do not match'}
              </p>
            )}
          </div>

          <Button
            className="w-full h-11"
            disabled={!isValid || loading}
            onClick={handleSubmit}
          >
            {loading ? (
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                Saving...
              </div>
            ) : (
              <div className="flex items-center gap-2">
                Set new password
                <ArrowRight className="h-4 w-4" />
              </div>
            )}
          </Button>
        </div>

        <div className="flex items-center justify-center">
          <Link
            href="/login"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to login
          </Link>
        </div>
      </div>
    </div>
  )
}
