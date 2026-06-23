import { Activity } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { WorkspaceLog } from '@/types'
import {
  ActionIcon,
  actionLabel,
  actorName,
  formatRelativeTime,
} from './helpers'

export function ActivityLogSection({
  logs,
  loading,
}: {
  logs: WorkspaceLog[] | null
  loading: boolean
}) {
  return (
    <div className="space-y-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
        <Activity className="h-5 w-5 text-primary" />
        Activity Log
      </h2>
      <Card className="border-border bg-card">
        {loading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-4">
                <Skeleton className="h-8 w-8 rounded-md" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </div>
            ))}
          </div>
        ) : logs && logs.length > 0 ? (
          <div className="divide-y divide-border">
            {logs.map(log => (
              <div
                key={log.id}
                className="flex items-center gap-3 p-4 transition-colors hover:bg-muted/50"
              >
                <ActionIcon action={log.action} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {actionLabel(log.action)}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {actorName(log)} · {formatRelativeTime(log.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 p-10 text-center text-muted-foreground">
            <Activity className="h-8 w-8 opacity-30" />
            <p className="text-sm">No activity yet</p>
            <p className="text-xs">Workspace events will appear here.</p>
          </div>
        )}
      </Card>
    </div>
  )
}
