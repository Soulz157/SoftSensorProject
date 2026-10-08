import { Skeleton } from '@/components/ui/skeleton'

/**
 * Placeholder for `/` while the session is still unknown. Mirrors
 * `LandingHero layout="tags"` (header, copy column, tag feed + diagram) so the
 * real page replaces it without a layout jump. Full-screen: AppLayout renders
 * no shell on `/` until the session is known.
 */
export function LandingSkeleton() {
  return (
    <div
      aria-busy
      className="flex min-h-svh flex-col overflow-x-clip bg-background"
    >
      <p role="status" className="sr-only">
        Loading
      </p>
      <div aria-hidden className="flex flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 px-6 py-5 md:px-10">
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-7 rounded-md" />
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="size-8 rounded-md" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="hidden h-8 w-28 sm:block" />
          </div>
        </header>

        <main className="grid flex-1 items-center gap-12 px-6 py-12 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.25fr)] md:px-10">
          <div className="max-w-3xl space-y-6">
            <div className="space-y-3">
              <Skeleton className="h-[clamp(2.25rem,4.5vw,3.5rem)] w-full max-w-md" />
              <Skeleton className="h-[clamp(2.25rem,4.5vw,3.5rem)] w-3/4 max-w-sm" />
            </div>
            <div className="max-w-[60ch] space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-2/3" />
            </div>
            <div className="flex flex-wrap gap-3">
              <Skeleton className="h-10 w-24" />
              <Skeleton className="h-10 w-36" />
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-0">
              <div className="flex items-end justify-between gap-3 border-b border-border pb-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-24" />
              </div>
              {Array.from({ length: 4 }, (_, i) => (
                <div
                  key={i}
                  className="flex h-[60px] items-center justify-between gap-3 border-b border-border"
                >
                  <div className="space-y-1.5">
                    <Skeleton className="h-3.5 w-28" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                  <Skeleton className="hidden h-6 w-12 sm:block" />
                  <Skeleton className="h-3.5 w-16" />
                </div>
              ))}
            </div>
            <Skeleton className="h-24 w-full rounded-xl sm:h-[240px]" />
          </div>
        </main>
      </div>
    </div>
  )
}
