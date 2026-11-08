'use client'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

/** One failure, one message: the whole page swaps to this, sections never
 *  render their own error beside stale or empty figures. */
export function IntakeError({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <section
      role="alert"
      className="flex flex-col items-start gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
    >
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </section>
  )
}

export function IntakeSkeleton() {
  return (
    <div aria-busy className="space-y-6">
      <p role="status" className="sr-only">
        Loading data intake
      </p>
      <div
        aria-hidden
        className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border ring-1 ring-foreground/10 lg:grid-cols-6"
      >
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="space-y-2 bg-card px-4 py-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-16" />
          </div>
        ))}
      </div>
      <div
        aria-hidden
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]"
      >
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
      <Skeleton aria-hidden className="h-64 rounded-xl" />
    </div>
  )
}
