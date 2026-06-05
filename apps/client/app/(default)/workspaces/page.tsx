'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb'
import { Activity, BrainCircuit, Plus, Loader2 } from 'lucide-react'
import { useWorkspaces } from '@/hooks/workspace/use-workspaces'
import { cn } from '@/lib/utils'
import { CreateWorkspaceDialog } from '@/components/create-workspace'
import { getNodes, type CanvasNode } from '@/services/canvas'
import {
  WorkspaceCard,
  WorkspaceCardSkeleton,
} from './components/workspace-card'

export default function WorkspacesPage() {
  const { workspaces, loading: workspacesLoading } = useWorkspaces()
  const [isOpen, setIsOpen] = useState(false)
  const [nodesByWorkspace, setNodesByWorkspace] = useState<Record<
    string,
    CanvasNode[]
  > | null>(null)

  const totalModels = workspaces.reduce((acc, w) => acc + w.modelsCount, 0)

  useEffect(() => {
    if (workspacesLoading || workspaces.length === 0) return

    let cancelled = false

    Promise.all(workspaces.map(w => getNodes(w.id)))
      .then(results => {
        if (cancelled) return
        const map: Record<string, CanvasNode[]> = {}
        workspaces.forEach((w, i) => {
          map[w.id] = results[i] ?? []
        })
        setNodesByWorkspace(map)
      })
      .catch(() => {
        if (!cancelled) setNodesByWorkspace({})
      })

    return () => {
      cancelled = true
    }
  }, [workspaces, workspacesLoading])

  const nodesLoading =
    !workspacesLoading && workspaces.length > 0 && nodesByWorkspace === null

  if (workspacesLoading || nodesLoading) {
    return (
      <div className="flex min-h-[50vh] flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm font-medium">
          {workspacesLoading ? 'Loading workspaces...' : 'Loading node data...'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto bg-background p-6 md:p-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Workspaces</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              All Workspaces
            </h1>
            <p className="mt-1 text-muted-foreground">
              Manage and monitor all your industrial workspaces
            </p>
          </div>
          <Button
            className="gap-2 bg-primary text-primary-foreground shadow-md hover:bg-primary/90"
            onClick={() => setIsOpen(true)}
          >
            <Plus className="h-4 w-4" />
            Create Workspace
          </Button>
        </div>

        <CreateWorkspaceDialog open={isOpen} onClose={() => setIsOpen(false)} />

        {/* Summary Cards */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card className="border-border bg-card">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-md bg-primary/10 p-2 text-primary">
                  <Activity className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">
                    {workspaces.length}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Total Workspaces
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-md bg-primary/10 p-2 text-primary">
                  <BrainCircuit className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">
                    {totalModels || '0'}
                  </p>
                  <p className="text-sm text-muted-foreground">Total Models</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Workspace Grid */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {workspacesLoading
            ? Array.from({ length: 4 }).map((_, i) => (
                <WorkspaceCardSkeleton key={i} />
              ))
            : workspaces.map(workspace => (
                <WorkspaceCard
                  key={workspace.id}
                  workspace={workspace}
                  nodes={nodesByWorkspace?.[workspace.id] ?? []}
                />
              ))}
        </div>

        {workspaces.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
            <Activity className={cn('h-10 w-10 opacity-30')} />
            <p className="text-base font-medium">No workspaces yet</p>
            <p className="text-sm">
              Create your first workspace to get started.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
