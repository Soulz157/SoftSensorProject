'use client'

import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  ArrowUpRight,
  BrainCircuit,
  ChevronRight,
  Clock,
  Layers,
  Map,
  Server,
} from 'lucide-react'
import { Workspace } from '@/types/dashboard'

interface WorkspaceListProps {
  workspaces: Workspace[]
}

export function WorkspaceList({ workspaces }: WorkspaceListProps) {
  const getWorkspaceStatus = (workspace: Workspace) => {
    const hasAlarm = workspace.nodes.some(n => n.status === 'alarm')
    const hasWarning = workspace.nodes.some(n => n.status === 'warning')
    const hasModelIssue = workspace.nodes.some(n =>
      n.models.some(m => m.status === 'error' || m.status === 'warning'),
    )

    if (hasAlarm) return 'alarm'
    if (hasWarning || hasModelIssue) return 'warning'
    return 'normal'
  }

  return (
    <div className="space-y-4 lg:col-span-2">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Layers className="h-5 w-5 text-primary" />
          Workspaces
        </h2>
        <Link href="/workspaces">
          <Button variant="ghost" size="sm" className="gap-1 text-primary">
            View All
            <ChevronRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {workspaces.map(workspace => {
          const status = getWorkspaceStatus(workspace)
          const nodeCount = workspace.nodes.length
          const modelCount =
            workspace.modelsCount ??
            workspace.nodes.reduce((acc, n) => acc + n.models.length, 0)

          return (
            <Card
              key={workspace.id}
              className="group border-border bg-card transition-all hover:border-primary/50"
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-foreground">
                        {workspace.name}
                      </h3>
                      <div
                        className={`h-2 w-2 rounded-full ${status === 'normal' ? 'bg-emerald-500' : status === 'warning' ? 'bg-amber-500' : 'bg-red-500'}`}
                      />
                    </div>
                    <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                      {workspace.description}
                    </p>
                  </div>
                  <Link href={`/workspaces/${workspace.id}`}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <ArrowUpRight className="h-4 w-4" />
                    </Button>
                  </Link>
                </div>

                <div className="mt-4 flex items-center gap-4">
                  <div className="flex items-center gap-1.5 text-sm">
                    <Server className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-foreground">
                      {nodeCount}
                    </span>
                    <span className="text-muted-foreground">nodes</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm">
                    <BrainCircuit className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-foreground">
                      {modelCount}
                    </span>
                    <span className="text-muted-foreground">models</span>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {workspace.lastUpdated}
                  </span>
                  <div className="flex gap-1">
                    <Link href={`/workspaces/${workspace.id}/canvas`}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 text-xs"
                      >
                        <Map className="h-3 w-3" />
                        Canvas
                      </Button>
                    </Link>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
