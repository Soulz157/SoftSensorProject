import { Loader2 } from 'lucide-react'

/**
 * Route-level fallback for the View All Workspaces segment: shown while the
 * route itself is being streamed in, BEFORE the client page mounts. The
 * in-page `WorkspaceCardSkeleton` grid is a separate thing — it covers the
 * client-side workspace fetch once the page is running.
 */
export default function WorkspacesLoading() {
  return (
    <div
      role="status"
      aria-label="Loading workspaces"
      className="flex min-h-[50vh] flex-1 flex-col items-center justify-center gap-4 text-muted-foreground"
    >
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-sm font-medium">Loading workspaces…</p>
    </div>
  )
}
