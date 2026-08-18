import { Skeleton } from '@/components/ui/skeleton'

/**
 * Skeleton mirror of the Datasets page: header + filter bar + a 3-up card grid
 * shaped like `DatasetsTab` cards, so content swaps in without layout shift.
 */
export default function DatasetsLoading() {
  return (
    <div
      role="status"
      aria-label="Loading datasets"
      className="mx-auto max-w-7xl space-y-6 px-4 py-8"
    >
      <span className="sr-only">Loading datasets…</span>

      {/* Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div className="flex items-center gap-3">
          <Skeleton className="h-12 w-12 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <Skeleton className="h-8 w-36 rounded-lg" />
      </div>

      {/* Filter bar */}
      <Skeleton className="h-10 w-full rounded-lg" />

      {/* Card grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col gap-4 rounded-xl bg-card p-5 ring-1 ring-foreground/10"
          >
            {/* Identity */}
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3 w-20" />
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-lg" />
                <Skeleton className="h-5 w-28" />
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/30 p-3">
              <div className="space-y-1.5">
                <Skeleton className="h-2.5 w-10" />
                <Skeleton className="h-4 w-14" />
              </div>
              <div className="space-y-1.5">
                <Skeleton className="h-2.5 w-10" />
                <Skeleton className="h-4 w-10" />
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-border pt-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
