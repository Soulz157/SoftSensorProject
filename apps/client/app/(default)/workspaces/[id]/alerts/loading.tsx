import { Loader2 } from 'lucide-react'

export default function AlertsWorkspaceLoading() {
  return (
    <div className="flex min-h-[50vh] flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-sm font-medium">{'Loading workspaces…'}</p>
    </div>
  )
}
