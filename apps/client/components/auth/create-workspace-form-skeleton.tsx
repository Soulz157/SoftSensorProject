import { Skeleton } from '@/components/ui/skeleton'

/**
 * Placeholder in the shape of `CreateWorkspaceForm`, shown on `/` to a
 * signed-in user while their workspaces load (or while they are being sent
 * to /overview) — so the real form never flashes for someone who has
 * workspaces.
 */
export function CreateWorkspaceFormSkeleton() {
  return (
    <div
      aria-busy
      className="w-full max-w-lg rounded-xl bg-card ring-1 ring-foreground/10"
    >
      <p role="status" className="sr-only">
        Loading
      </p>
      <div aria-hidden>
        <div className="flex items-center gap-4 p-6 pb-4">
          <Skeleton className="size-12 shrink-0 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
        </div>
        <div className="space-y-5 px-6 pb-6">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    </div>
  )
}
