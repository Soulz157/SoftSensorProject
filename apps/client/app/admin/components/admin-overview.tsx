'use client'

import { useState } from 'react'
import { Building2, Box, Activity, Plus } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useWorkspaces } from '@/hooks/workspace/use-workspaces'
import { CreateWorkspaceDialog } from '@/components/create-workspace'
import type { Workspace } from '@/types'
import { useSession } from 'next-auth/react'

function WorkspaceTableSkeleton() {
  const { data: session } = useSession()
  // console.log('Session in AdminOverview:', session)
  return (
    <>
      {Array.from({ length: 3 }).map((_, i) => (
        <TableRow key={i}>
          <TableCell>
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-4 rounded" />
              <Skeleton className="h-4 w-36" />
            </div>
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-24" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-5 w-16 rounded-full" />
          </TableCell>
        </TableRow>
      ))}
    </>
  )
}

function StatCard({
  title,
  value,
  icon: Icon,
  description,
  loading,
}: {
  title: string
  value: string | number
  icon: React.ElementType
  description?: string
  loading?: boolean
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <>
            <Skeleton className="h-8 w-16 mb-1" />
            <Skeleton className="h-3 w-28" />
          </>
        ) : (
          <>
            <div className="text-2xl font-bold text-foreground">{value}</div>
            {description && (
              <p className="mt-1 text-xs text-muted-foreground">
                {description}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function WorkspaceRow({ workspace }: { workspace: Workspace }) {
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 shrink-0">
            <Building2 className="h-3.5 w-3.5 text-primary" />
          </div>
          <span className="text-sm font-medium text-foreground">
            {workspace.name}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <span className="text-sm text-muted-foreground">
          {workspace.modelsCount} model{workspace.modelsCount !== 1 ? 's' : ''}
        </span>
      </TableCell>
      <TableCell>
        <Badge variant="secondary">Active</Badge>
      </TableCell>
    </TableRow>
  )
}

export function AdminOverview() {
  const [createOpen, setCreateOpen] = useState(false)
  const { workspaces, loading: isLoading } = useWorkspaces()

  const totalWorkspaces = workspaces.length
  const totalModels = workspaces.reduce(
    (sum, ws) => sum + (ws.modelsCount ?? 0),
    0,
  )

  return (
    <div className="flex-1 overflow-auto p-6">
      {/* Page header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            System Overview
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage workspaces and monitor platform activity.
          </p>
        </div>
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="h-4 w-4" />
          New Workspace
        </Button>
        <CreateWorkspaceDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
        />
      </div>

      {/* Stat cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Total Workspaces"
          value={isLoading ? 0 : totalWorkspaces}
          icon={Building2}
          description="Your active workspaces"
          loading={isLoading}
        />
        <StatCard
          title="Total Models"
          value={isLoading ? 0 : totalModels}
          icon={Box}
          description="Across all workspaces"
          loading={isLoading}
        />
        <StatCard
          title="Platform Status"
          value="Operational"
          icon={Activity}
          description="All systems normal"
          loading={false}
        />
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Workspace table — 2/3 width */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base font-medium">
                Workspaces
              </CardTitle>
              <span className="text-xs text-muted-foreground">
                {isLoading ? '...' : `${totalWorkspaces} total`}
              </span>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Models</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <WorkspaceTableSkeleton />
                  ) : workspaces.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={3}
                        className="py-8 text-center text-sm text-muted-foreground"
                      >
                        No workspaces found. Create one to get started.
                      </TableCell>
                    </TableRow>
                  ) : (
                    workspaces.map(ws => (
                      <WorkspaceRow key={ws.id} workspace={ws} />
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        {/* Quick stats — 1/3 width */}
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-medium">
                Quick Stats
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-4 w-12" />
                  </div>
                ))
              ) : (
                <>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Workspaces</span>
                    <span className="font-medium text-foreground">
                      {totalWorkspaces}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Models</span>
                    <span className="font-medium text-foreground">
                      {totalModels}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Active</span>
                    <Badge variant="secondary" className="text-xs">
                      {totalWorkspaces}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Health</span>
                    <Badge className="text-xs">Good</Badge>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
