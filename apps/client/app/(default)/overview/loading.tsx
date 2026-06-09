import { Skeleton } from '@/components/ui/skeleton'

export default function PlantsLoading() {
  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      {/* Canvas skeleton */}
      <div className="relative flex-1 p-4">
        <Skeleton className="h-full w-full rounded-xl" />
      </div>
    </div>
  )
}
