import Link from 'next/link'
import { ArrowRight, Cpu, Map } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { CanvasNode } from '@/services/canvas'
import { getNodeIcon, statusColors } from './helpers'

export function EquipmentSection({
  nodes,
  loading,
  workspaceId,
}: {
  nodes: CanvasNode[] | null
  loading: boolean
  workspaceId: string
}) {
  return (
    <div className="space-y-4 lg:col-span-1">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Cpu className="h-5 w-5 text-primary" />
          Equipment in Workspace
        </h2>
        <Link href={`/workspaces/${workspaceId}/canvas`}>
          <Button
            variant="ghost"
            size="sm"
            className="cursor-pointer gap-1 text-xs text-primary"
          >
            View All
            <ArrowRight className="h-3 w-3" />
          </Button>
        </Link>
      </div>
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
        ) : nodes && nodes.length > 0 ? (
          <div className="max-h-96 divide-y divide-border overflow-y-auto">
            {nodes.map(node => {
              const isAbnormal = node.data.status !== 'normal'
              const sc = statusColors(isAbnormal ? 'alarm' : 'normal')
              return (
                <div
                  key={node.id}
                  className="flex items-center justify-between p-4 transition-colors hover:bg-muted/50"
                >
                  <div className="flex items-center gap-3">
                    <div className={cn('rounded-md p-2', sc.bg, sc.text)}>
                      {getNodeIcon(node.data.type)}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {node.data.name}
                      </p>
                      <div className="mt-0.5 flex items-center gap-2">
                        <span className="text-xs capitalize text-muted-foreground">
                          {node.data.type}
                        </span>
                        <span
                          className={cn('h-1.5 w-1.5 rounded-full', sc.dot)}
                        />
                        <span
                          className={cn(
                            'text-xs font-medium capitalize',
                            sc.text,
                          )}
                        >
                          {isAbnormal ? 'Abnormal' : 'Normal'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 p-10 text-center text-muted-foreground">
            <Cpu className="h-8 w-8 opacity-30" />
            <p className="text-sm">No equipment yet</p>
            <p className="text-xs">
              Add equipment via the canvas to see it here.
            </p>
          </div>
        )}
      </Card>
    </div>
  )
}
