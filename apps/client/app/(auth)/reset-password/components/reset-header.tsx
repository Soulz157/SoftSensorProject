import { Activity } from 'lucide-react'

interface ResetPasswordHeaderProps {
  isSubmitted: boolean
}

export function ResetPasswordHeader({ isSubmitted }: ResetPasswordHeaderProps) {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
        <Activity className="h-6 w-6 text-primary-foreground" />
      </div>
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-foreground">
          {isSubmitted ? 'Check your email' : 'Reset your password'}
        </h1>
        <p className="mt-1 text-muted-foreground">
          {isSubmitted
            ? "We've sent you a password reset link"
            : 'Enter your email to receive a reset link'}
        </p>
      </div>
    </div>
  )
}
