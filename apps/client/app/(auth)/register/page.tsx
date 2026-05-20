import Link from 'next/link'
import { RegisterHeader } from './components/register-header'
import { RegisterForm } from './components/register-form'
import { SocialAuth } from './components/social-auth'

export default function RegisterPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-8">
        <RegisterHeader />

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <RegisterForm />
          <SocialAuth />
        </div>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link
            href="/login"
            className="text-primary hover:text-primary/80 font-medium transition-colors"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
