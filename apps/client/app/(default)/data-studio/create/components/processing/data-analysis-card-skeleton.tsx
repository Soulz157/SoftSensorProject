import { Skeleton } from '@/components/ui/skeleton'

/**
 * Loading placeholder for `DataAnalysisCard`, shown while Step 3.1's preview
 * sample is still in flight. Mirrors the real card's shell/header/tab-strip/
 * chart/table structure at the same heights so swapping in `DataAnalysisCard`
 * once the sample resolves causes zero layout shift.
 */
export function DataAnalysisCardSkeleton() {
  return (
    <div className="space-y-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-5 w-56 motion-reduce:animate-none" />
      </div>

      <div className="mb-4 flex flex-wrap gap-4 border-b border-border pb-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-24 motion-reduce:animate-none" />
        ))}
      </div>

      <Skeleton className="mb-3 h-3 w-72 motion-reduce:animate-none" />

      <Skeleton className="h-100 w-full motion-reduce:animate-none" />

      <div className="rounded-lg border border-border overflow-hidden">
        <Skeleton className="h-90 w-full motion-reduce:animate-none" />
      </div>
    </div>
  )
}
