import { CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ResetPasswordSuccessProps {
  email: string
  onRetry: () => void
}

export function ResetPasswordSuccess({
  email,
  onRetry,
}: ResetPasswordSuccessProps) {
  return (
    <div className="space-y-6 text-center">
      <div className="flex justify-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <CheckCircle2 className="h-7 w-7 text-primary" />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-muted-foreground">
          We sent a password reset link to
        </p>
        <p className="font-medium text-foreground">{email}</p>
      </div>

      <div className="space-y-3 pt-2">
        <p className="text-sm text-muted-foreground">
          {"Didn't receive the email? Check your spam folder or"}
        </p>
        <Button
          variant="outline"
          onClick={onRetry}
          className="bg-secondary/30 border-border hover:bg-secondary/50 transition-colors"
        >
          Try another email
        </Button>
      </div>
    </div>
  )
}
