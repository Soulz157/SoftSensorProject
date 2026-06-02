'use client'

import { useState, useEffect, useRef } from 'react'
import { Building2, Activity, Search } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useAdminWorkspaces } from '@/hooks/admin/use-admin-workspaces'
import { WorkspaceTable } from '@/app/admin/workspaces/components/workspace-table'
import { ActivityLogTable } from '@/app/admin/activity/components/activity-log-table'

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
            <Skeleton className="mb-1 h-8 w-16" />
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

export function AdminOverview() {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [search])

  const { data: statsData, loading: statsLoading } = useAdminWorkspaces({
    page: 1,
    limit: 1,
  })

  const totalWorkspaces = statsData?.total ?? 0

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">
          System Overview
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage workspaces and monitor platform activity.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard
          title="Total Workspaces"
          value={totalWorkspaces}
          icon={Building2}
          description="All platform workspaces"
          loading={statsLoading}
        />
        <StatCard
          title="Platform Status"
          value="Operational"
          icon={Activity}
          description="All systems normal"
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base">All Workspaces</CardTitle>
              <CardDescription>
                Each workspace shows its owner and model count.
              </CardDescription>
            </div>
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search workspaces…"
                className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <WorkspaceTable search={debouncedSearch} />
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Recent Activity</CardTitle>
          <CardDescription>
            Latest login and logout events across all users.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ActivityLogTable />
        </CardContent>
      </Card>
    </div>
  )
}
