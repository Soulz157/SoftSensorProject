import { Skeleton } from '@/components/ui/skeleton'

/**
 * Shared loading skeleton for the overview map surface. Used by both the route
 * `loading.tsx` (server) and the page's client-fetch loading branch so the two
 * never drift into different looks.
 */
export function OverviewSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading plants"
      className="flex h-full w-full overflow-hidden bg-background"
    >
      <div className="relative flex-1 p-4">
        <Skeleton className="h-full w-full rounded-xl" />
      </div>
      <span className="sr-only">Loading plants…</span>
    </div>
  )
}
