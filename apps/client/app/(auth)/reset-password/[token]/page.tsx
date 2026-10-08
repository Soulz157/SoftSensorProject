'use client'

import { useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { authService } from '@/services/auth'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { AuthShell } from '@/components/auth/auth-shell'
import { FormField } from '@/components/auth/form-field'
import { PasswordField } from '@/components/auth/password-field'
import { PasswordStrength } from '@/components/auth/password-strength'
import { TextLink } from '@/components/auth/text-link'
import { newPasswordSchema, type NewPasswordValues } from '@/lib/auth-schemas'

export default function SetNewPasswordPage() {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()
  const email = useSearchParams().get('email')
  const [success, setSuccess] = useState(false)

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<NewPasswordValues>({
    resolver: zodResolver(newPasswordSchema),
    mode: 'onTouched',
    defaultValues: { password: '', confirmPassword: '' },
  })
  const password = useWatch({ control, name: 'password' })

  async function onSubmit(values: NewPasswordValues) {
    if (!email) {
      toast.error('This reset link is missing your email', {
        description:
          'Open the link from your email again, or request a new one.',
      })
      return
    }
    try {
      await authService.resetPassword({
        email,
        token,
        password: values.password,
      })
      setSuccess(true)
    } catch (err) {
      toast.error("Couldn't update your password", {
        description:
          err instanceof Error
            ? err.message
            : 'The link may have expired. Request a new one and try again.',
      })
    }
  }

  if (success) {
    return (
      <AuthShell
        title="Password updated"
        description="Sign in with your new password."
      >
        <Button className="h-9 w-full" onClick={() => router.push('/login')}>
          Sign in
        </Button>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Set a new password"
      description={
        email ? (
          <>
            For <span className="font-medium text-foreground">{email}</span>
          </>
        ) : undefined
      }
      footer={
        <>
          Back to <TextLink href="/login">Sign in</TextLink>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
        <FormField
          id="password"
          label="New password"
          error={errors.password?.message}
        >
          <PasswordField
            id="password"
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            aria-describedby={
              errors.password
                ? 'password-error password-rules'
                : 'password-rules'
            }
            {...register('password')}
          />
        </FormField>
        <PasswordStrength id="password-rules" password={password} />
        <FormField
          id="confirmPassword"
          label="Confirm new password"
          error={errors.confirmPassword?.message}
        >
          <PasswordField
            id="confirmPassword"
            autoComplete="new-password"
            aria-invalid={!!errors.confirmPassword}
            aria-describedby={
              errors.confirmPassword ? 'confirmPassword-error' : undefined
            }
            {...register('confirmPassword')}
          />
        </FormField>
        <Button type="submit" className="h-9 w-full" disabled={isSubmitting}>
          {isSubmitting && <Spinner />}
          {isSubmitting ? 'Updating password' : 'Update password'}
        </Button>
      </form>
    </AuthShell>
  )
}
