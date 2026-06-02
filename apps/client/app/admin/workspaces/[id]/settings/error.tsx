'use client'

import { Button } from '@/components/ui/button'

export default function Error({
  error,
  reset,
}: {
  error: Error
  reset: () => void
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
      <p className="text-sm text-muted-foreground">
        {error.message || 'Something went wrong loading this page.'}
      </p>
      <Button size="sm" variant="outline" onClick={reset}>
        Try again
      </Button>
    </div>
  )
}
