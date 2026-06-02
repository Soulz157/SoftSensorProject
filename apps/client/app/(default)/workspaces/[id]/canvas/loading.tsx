import { Skeleton } from '@/components/ui/skeleton'

export default function CanvasLoading() {
  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex flex-1 flex-col">
        {/* Toolbar skeleton */}
        <div className="flex items-center justify-between border-b border-border bg-card px-4 py-2">
          <div className="space-y-1">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-3 w-28" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-28 rounded-md" />
            <Skeleton className="h-8 w-8 rounded-md" />
            <Skeleton className="h-8 w-8 rounded-md" />
            <Skeleton className="h-8 w-8 rounded-md" />
          </div>
        </div>
        {/* Canvas skeleton */}
        <div className="relative flex-1 animate-pulse bg-muted/30" />
      </div>
    </div>
  )
}
