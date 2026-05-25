'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'

interface AdminErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function AdminError({ error, reset }: AdminErrorProps) {
  useEffect(() => {
    console.error('[Admin] Page error:', error)
  }, [error])

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="h-6 w-6 text-destructive" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">
          Something went wrong
        </h2>
        <p className="text-sm text-muted-foreground">
          {error.message || 'An unexpected error occurred on the admin page.'}
        </p>
      </div>
      <Button variant="outline" onClick={reset}>
        Try again
      </Button>
    </div>
  )
}
