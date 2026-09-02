import { Skeleton } from '@/components/ui/skeleton'

/**
 * Skeleton mirror of the Datasets page: header + filter bar + a row list
 * shaped like `DatasetsTab` rows, so content swaps in without layout shift.
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

      {/* Row list */}
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-6 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
          >
            {/* Identity */}
            <div className="flex flex-1 items-start gap-3">
              <Skeleton className="h-10 w-10 rounded-lg" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
            </div>

            {/* Metrics */}
            <div className="grid flex-1 grid-cols-3 gap-6">
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="space-y-1.5">
                  <Skeleton className="h-2.5 w-12" />
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </div>

            {/* Meta */}
            <div className="hidden shrink-0 space-y-1 sm:block">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
