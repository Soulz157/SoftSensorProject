import { Skeleton } from '@/components/ui/skeleton'

export default function WorkspaceMembersLoading() {
  return (
    <div className="flex-1 overflow-auto bg-background p-6 md:p-8">
      <div className="mx-auto max-w-3xl space-y-8">
        <Skeleton className="h-4 w-56" />

        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-md" />
          <div className="space-y-1.5">
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-4 w-44" />
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-8 w-16 rounded-md" />
          </div>
          <div className="rounded-md border border-border overflow-hidden">
            <div className="border-b border-border bg-muted/40 px-4 py-3">
              <div className="flex gap-8">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-10" />
              </div>
            </div>
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="flex items-center justify-between border-b border-border px-4 py-3.5 last:border-0"
              >
                <div className="flex items-center gap-2.5">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className="space-y-1">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-3 w-36" />
                  </div>
                </div>
                <Skeleton className="h-5 w-14 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
