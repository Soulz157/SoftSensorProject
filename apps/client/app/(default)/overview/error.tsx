'use client'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'

interface ErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function PlantsError({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4">
      <AlertTriangle className="h-10 w-10 text-destructive" />
      <div className="text-center">
        <p className="text-sm font-semibold">Failed to load plants data</p>
        <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>
      </div>
      <Button size="sm" variant="outline" onClick={reset}>
        Try again
      </Button>
    </div>
  )
}
