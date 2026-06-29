import { Skeleton } from '@/components/ui/skeleton'

export default function LoadingModelPage() {
  return (
    <div className="flex-1 overflow-auto p-6 md:p-8">
      <Skeleton className="mb-6 h-5 w-28" />
      <Skeleton className="mb-4 h-10 w-72" />
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
      <Skeleton className="mt-6 h-10 w-64 rounded-lg" />
      <Skeleton className="mt-3 h-64 rounded-lg" />
    </div>
  )
}
