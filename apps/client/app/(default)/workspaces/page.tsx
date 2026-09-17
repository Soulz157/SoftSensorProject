'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb'
import { Activity, BrainCircuit, Plus } from 'lucide-react'
import { useWorkspaces } from '@/hooks/workspace/use-workspaces'
import { CreateWorkspaceDialog } from '@/components/create-workspace'
import {
  WorkspaceCard,
  WorkspaceCardSkeleton,
} from './components/workspace-card'

export default function WorkspacesPage() {
  const { workspaces, loading: workspacesLoading } = useWorkspaces()
  const [isOpen, setIsOpen] = useState(false)

  // A count the payload does not carry is UNKNOWN, so the total is unknown
  // too — summing it as zero would silently under-report. `null` renders an
  // em-dash, exactly as the per-card counts do.
  const totalModels = workspaces.some(w => typeof w.modelsCount !== 'number')
    ? null
    : workspaces.reduce((acc, w) => acc + (w.modelsCount ?? 0), 0)

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
            className="cursor-pointer gap-2 bg-primary text-primary-foreground shadow-md hover:bg-primary/90"
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
                  <p className="text-2xl font-bold text-foreground tabular-nums">
                    {totalModels ?? '—'}
                  </p>
                  <p className="text-sm text-muted-foreground">Total Models</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Workspace Grid — loading / empty / populated are ONE branch, so the
            empty state replaces the grid instead of rendering beneath it. */}
        {workspacesLoading ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <WorkspaceCardSkeleton key={i} />
            ))}
          </div>
        ) : workspaces.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
            <Activity className="h-10 w-10 opacity-30" />
            <p className="text-base font-medium">No workspaces yet</p>
            <p className="text-sm">
              Create your first workspace to get started.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {workspaces.map(workspace => (
              <WorkspaceCard
                key={workspace.id}
                workspace={workspace}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
