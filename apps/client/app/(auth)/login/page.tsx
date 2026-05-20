'use client'

import Link from 'next/link'
import { LoginHeader } from './components/login-header'
import { FormCard } from './components/form-card'
import { SocialLogin } from './components/social-login'
import { useAuth } from '@/hooks/auth/use-auth'

export default function LoginClient() {
  const { login, isLoading } = useAuth()

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-8">
        <LoginHeader />
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <FormCard onSubmit={login} isLoading={isLoading} />
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">
                Or continue with
              </span>
            </div>
          </div>
          <SocialLogin />
        </div>
        <p className="text-center text-sm text-muted-foreground">
          {"Don't have an account? "}
          <Link
            href="/register"
            className="text-primary hover:text-primary/80 font-medium transition-colors"
          >
            Create account
          </Link>
        </p>
      </div>
    </div>
  )
}
