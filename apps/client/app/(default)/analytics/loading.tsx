import { Skeleton } from '@/components/ui/skeleton'

export default function AnalyticsLoading() {
  return (
    <div className="flex-1 space-y-6 overflow-auto p-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-9 w-72" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-72 w-full rounded-xl lg:col-span-2" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>

      <Skeleton className="h-96 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  )
}
