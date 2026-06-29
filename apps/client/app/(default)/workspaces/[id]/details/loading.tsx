import { Skeleton } from '@/components/ui/skeleton'

export default function WorkspaceDetailLoading() {
  return (
    <div className="flex-1 overflow-auto bg-background p-6 md:p-8">
      <div className="mx-auto max-w-7xl space-y-8">
        {/* Breadcrumb skeleton */}
        <Skeleton className="h-4 w-48" />

        {/* Header skeleton */}
        <div className="flex flex-col gap-4 md:flex-row md:items-start">
          <div className="space-y-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="ml-auto flex gap-3">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-32" />
          </div>
        </div>

        {/* KPI cards skeleton */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg border border-border bg-card p-6"
            >
              <div className="flex items-start justify-between">
                <div className="space-y-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-8 w-16" />
                </div>
                <Skeleton className="h-9 w-9 rounded-md" />
              </div>
              <Skeleton className="mt-4 h-3 w-32" />
            </div>
          ))}
        </div>

        {/* 3-column skeleton */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-4">
              <Skeleton className="h-5 w-36" />
              <div className="rounded-lg border border-border bg-card">
                {Array.from({ length: 4 }).map((_, j) => (
                  <div
                    key={j}
                    className="flex items-center gap-3 border-b border-border p-4 last:border-0"
                  >
                    <Skeleton className="h-9 w-9 rounded-md" />
                    <div className="flex-1 space-y-1">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
