'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb'
import { Activity, BrainCircuit, ChevronRight, Map, Plus } from 'lucide-react'
import { useWorkspaces } from '@/hooks/workspace/use-workspaces'
import { workspaceIcons, workspaceColors } from '@/store/workspace'
import type { Workspace } from '@/types'
import { CreateWorkspaceDialog } from '@/components/create-workspace'

function WorkspaceIcon({
  iconId,
  colorId,
}: {
  iconId: string
  colorId: string
}) {
  const selectedIcon = workspaceIcons.find(item => item.id === iconId)
  const Icon = selectedIcon?.icon
  const selectedColor = workspaceColors.find(item => item.id === colorId)
  const bgClass = selectedColor?.bg || 'bg-slate-500'

  return (
    <span
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white text-sm font-semibold ${bgClass}`}
    >
      {Icon ? (
        <Icon className="h-5 w-5" />
      ) : (
        <span>{iconId?.charAt(0)?.toUpperCase() || '?'}</span>
      )}
    </span>
  )
}

function WorkspaceCard({ workspace }: { workspace: Workspace }) {
  return (
    <Card className="group border-border bg-card transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5">
      <CardContent className="p-0">
        {/* Header */}
        <div className="flex items-start gap-4 border-b border-border p-5">
          <WorkspaceIcon
            iconId={workspace.icon || 'box'}
            colorId={workspace.color || 'slate'}
          />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-lg font-semibold text-foreground">
              {workspace.name}
            </h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {workspace.modelsCount} AI model
              {workspace.modelsCount !== 1 ? 's' : ''} deployed
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 divide-x divide-border border-b border-border">
          <div className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">
              {workspace.modelsCount ? workspace.modelsCount : '0'}
            </p>
            <p className="text-xs text-muted-foreground">Models</p>
          </div>
          <div className="p-4 text-center">
            <div className="flex items-center justify-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <p className="text-sm font-medium text-emerald-500">Online</p>
            </div>
            <p className="text-xs text-muted-foreground">Status</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/20 px-5 py-3">
          <Link href={`/workspaces/${workspace.id}/canvas`}>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs">
              <Map className="h-3.5 w-3.5" />
              Canvas
            </Button>
          </Link>
          <Link href={`/workspaces/${workspace.id}`}>
            <Button
              size="sm"
              className="h-8 gap-1 bg-primary text-xs text-primary-foreground hover:bg-primary/90"
            >
              View Details
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}

function WorkspaceCardSkeleton() {
  return (
    <Card className="border-border bg-card">
      <CardContent className="p-0">
        <div className="flex items-start gap-4 border-b border-border p-5">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
        <div className="grid grid-cols-2 divide-x divide-border border-b border-border">
          <div className="p-4">
            <Skeleton className="mx-auto h-8 w-8" />
          </div>
          <div className="p-4">
            <Skeleton className="mx-auto h-5 w-16" />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-24" />
        </div>
      </CardContent>
    </Card>
  )
}

export default function WorkspacesPage() {
  const { workspaces, loading } = useWorkspaces()
  const [isOpen, setIsOpen] = useState(false)

  const totalModels = workspaces.reduce((acc, w) => acc + w.modelsCount, 0)

  return (
    <div className="flex-1 overflow-auto bg-background p-6 md:p-8">
      <div className="mx-auto max-w-7xl space-y-8">
        {/* Breadcrumb */}
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Workspaces</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Header */}
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
                  {loading ? (
                    <Skeleton className="h-8 w-12" />
                  ) : (
                    <p className="text-2xl font-bold text-foreground">
                      {workspaces.length}
                    </p>
                  )}
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
                  {loading ? (
                    <Skeleton className="h-8 w-12" />
                  ) : (
                    <p className="text-2xl font-bold text-foreground">
                      {totalModels ? totalModels : '0'}
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground">Total Models</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Workspace Grid */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {loading
            ? Array.from({ length: 4 }).map((_, i) => (
                <WorkspaceCardSkeleton key={i} />
              ))
            : workspaces.map(workspace => (
                <WorkspaceCard key={workspace.id} workspace={workspace} />
              ))}
        </div>

        {!loading && workspaces.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
            <Activity className="h-10 w-10 opacity-30" />
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
