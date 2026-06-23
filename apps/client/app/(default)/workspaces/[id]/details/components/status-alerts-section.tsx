import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { CanvasNode } from '@/services/canvas'
import { equipmentAlerts } from '@/lib/overview-status'
import { getNodeIcon, statusColors } from './helpers'

export function StatusAlertsSection({
  nodes,
  loading,
}: {
  nodes: CanvasNode[] | null
  loading: boolean
}) {
  const alerts = equipmentAlerts(nodes ?? [])

  return (
    <div className="space-y-4 lg:col-span-1">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
        <AlertTriangle className="h-5 w-5 text-amber-500" />
        Status Alerts
      </h2>
      <Card className="border-border bg-card">
        {loading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-4">
                <Skeleton className="h-8 w-8 rounded-md" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : alerts.length > 0 ? (
          <div className="max-h-96 divide-y divide-border overflow-y-auto">
            {alerts.map(node => {
              const sc = statusColors(node.data.status)
              return (
                <div
                  key={node.id}
                  className="flex items-center gap-3 p-4 transition-colors hover:bg-muted/50"
                >
                  <div className={cn('rounded-md p-2', sc.bg, sc.text)}>
                    {getNodeIcon(node.data.type)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {node.data.name}
                    </p>
                    <p className="text-xs capitalize text-muted-foreground">
                      {node.data.type}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize',
                      sc.bg,
                      sc.text,
                    )}
                  >
                    {node.data.status}
                  </span>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 p-10 text-center text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            <p className="text-sm">No alerts</p>
            <p className="text-xs">All equipment operating normally.</p>
          </div>
        )}
      </Card>
    </div>
  )
}
