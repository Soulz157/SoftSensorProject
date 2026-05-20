import { Mail, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface ResetPasswordFormProps {
  email: string
  setEmail: (email: string) => void
  isLoading: boolean
  onSubmit: (e: React.FormEvent) => void
}

export function ResetPasswordForm({
  email,
  setEmail,
  isLoading,
  onSubmit,
}: ResetPasswordFormProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">
          Email Address
        </label>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="email"
            placeholder="name@company.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="pl-10 h-11 bg-secondary/50 border-border focus:bg-background transition-colors"
            required
          />
        </div>
      </div>

      <Button
        type="submit"
        className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-all"
        disabled={isLoading}
      >
        {isLoading ? (
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
            Sending link...
          </div>
        ) : (
          <div className="flex items-center gap-2">
            Send reset link
            <ArrowRight className="h-4 w-4" />
          </div>
        )}
      </Button>
    </form>
  )
}
