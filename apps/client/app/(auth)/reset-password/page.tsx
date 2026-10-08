'use client'
export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { AuthShell } from '@/components/auth/auth-shell'
import { TextLink } from '@/components/auth/text-link'
import { useResetPassword } from '@/hooks/auth/use-reset-password'
import { ResetPasswordForm } from './components/reset-form'

export default function ResetPasswordPage() {
  const [email, setEmail] = useState('')
  const { forgotPassword, isLoading, isSubmitted, setIsSubmitted } =
    useResetPassword()

  if (isSubmitted) {
    return (
      <AuthShell
        title="Check your email"
        description={
          <>
            We sent a reset link to{' '}
            <span className="font-medium text-foreground">{email}</span>. Open
            it to set a new password. If it isn&apos;t there, check your spam
            folder.
          </>
        }
        footer={
          <>
            Back to <TextLink href="/login">Sign in</TextLink>
          </>
        }
      >
        <Button
          type="button"
          variant="outline"
          className="h-9 w-full"
          onClick={() => setIsSubmitted(false)}
        >
          Use a different email
        </Button>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Reset your password"
      description="Enter your account email. We'll send a link to set a new password."
      footer={
        <>
          Remembered it? <TextLink href="/login">Sign in</TextLink>
        </>
      }
    >
      <ResetPasswordForm
        defaultEmail={email}
        isLoading={isLoading}
        onSubmit={async value => {
          setEmail(value)
          await forgotPassword(value)
        }}
      />
    </AuthShell>
  )
}
