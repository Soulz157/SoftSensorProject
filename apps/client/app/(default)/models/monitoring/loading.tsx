import { Skeleton } from '@/components/ui/skeleton'

export default function MonitoringLoading() {
  return (
    <div className="flex flex-1 flex-col gap-5 p-4 lg:p-6">
      {/* Header */}
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-80" />
      </div>

      {/* Toolbar: model picker + range + RMSE tile */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-9 w-40" />
        </div>
        <Skeleton className="h-16 w-52 rounded-xl" />
      </div>

      {/* Two stacked chart cards */}
      <Skeleton className="h-100 w-full rounded-xl" />
      <Skeleton className="h-70 w-full rounded-xl" />
    </div>
  )
}
