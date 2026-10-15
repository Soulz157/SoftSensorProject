'use client'

import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { AuthShell } from '@/components/auth/auth-shell'
import { FormField } from '@/components/auth/form-field'
import { PasswordField } from '@/components/auth/password-field'
import { PasswordStrength } from '@/components/auth/password-strength'
import { TextLink } from '@/components/auth/text-link'
import { useChangePassword } from '@/hooks/auth/use-change-password'
import {
  changePasswordSchema,
  type ChangePasswordValues,
} from '@/lib/auth-schemas'

type Field = keyof ChangePasswordValues

export default function ChangePasswordPage() {
  const { changePassword, isLoading, isSuccess, router } = useChangePassword()
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    mode: 'onTouched',
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  })
  const newPassword = useWatch({ control, name: 'newPassword' })

  if (isSuccess) {
    return (
      <AuthShell
        title="Password updated"
        description="Use your new password the next time you sign in."
      >
        <Button className="h-9 w-full" onClick={() => router.push('/settings')}>
          Back to settings
        </Button>
      </AuthShell>
    )
  }

  const describedBy = (name: Field, extra?: string) =>
    [errors[name] ? `${name}-error` : null, extra].filter(Boolean).join(' ') ||
    undefined

  return (
    <AuthShell
      title="Change password"
      description="You'll stay signed in on this device."
      footer={<TextLink href="/settings">Back to settings</TextLink>}
    >
      <form
        className="space-y-4"
        onSubmit={handleSubmit(changePassword)}
        noValidate
      >
        <FormField
          id="currentPassword"
          label="Current password"
          error={errors.currentPassword?.message}
        >
          <PasswordField
            id="currentPassword"
            autoComplete="current-password"
            aria-invalid={!!errors.currentPassword}
            aria-describedby={describedBy('currentPassword')}
            {...register('currentPassword')}
          />
        </FormField>
        <FormField
          id="newPassword"
          label="New password"
          error={errors.newPassword?.message}
        >
          <PasswordField
            id="newPassword"
            autoComplete="new-password"
            aria-invalid={!!errors.newPassword}
            aria-describedby={describedBy('newPassword', 'newPassword-rules')}
            {...register('newPassword')}
          />
        </FormField>
        <PasswordStrength id="newPassword-rules" password={newPassword} />
        <FormField
          id="confirmPassword"
          label="Confirm new password"
          error={errors.confirmPassword?.message}
        >
          <PasswordField
            id="confirmPassword"
            autoComplete="new-password"
            aria-invalid={!!errors.confirmPassword}
            aria-describedby={describedBy('confirmPassword')}
            {...register('confirmPassword')}
          />
        </FormField>
        <Button type="submit" className="h-9 w-full" disabled={isLoading}>
          {isLoading && <Spinner />}
          {isLoading ? 'Updating password' : 'Update password'}
        </Button>
      </form>
    </AuthShell>
  )
}
