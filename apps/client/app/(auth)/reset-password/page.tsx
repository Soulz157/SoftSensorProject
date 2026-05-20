'use client'
export const dynamic = 'force-dynamic'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { ResetPasswordHeader } from './components/reset-header'
import { ResetPasswordForm } from './components/reset-form'
import { ResetPasswordSuccess } from './components/reset-success'

export default function ResetPasswordPage() {
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [email, setEmail] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    await new Promise(resolve => setTimeout(resolve, 1000))
    setIsLoading(false)
    setIsSubmitted(true)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-8">
        <ResetPasswordHeader isSubmitted={isSubmitted} />
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          {!isSubmitted ? (
            <ResetPasswordForm
              email={email}
              setEmail={setEmail}
              isLoading={isLoading}
              onSubmit={handleSubmit}
            />
          ) : (
            <ResetPasswordSuccess
              email={email}
              onRetry={() => setIsSubmitted(false)}
            />
          )}
        </div>
        s{' '}
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
