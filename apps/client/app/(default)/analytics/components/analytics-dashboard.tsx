'use client'

import { useState } from 'react'
import { usePipelineAnalytics } from '@/hooks/use-pipeline-analytics'
import type { Scope } from '@/lib/pipeline-metrics'
import type { TimeRange } from '@/lib/mock-readings'
import { AnalyticsHeader } from './analytics-header'
import { PipelineKpiCards } from './pipeline-kpi-cards'
import { TagHealthDonut } from './tag-health-donut'
import { IngestionTrendChart } from './ingestion-trend-chart'
import { PipelineWorkspaceTable } from './pipeline-workspace-table'
import { QuickVisualizerPanel } from './quick-visualizer-panel'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export function AnalyticsDashboard({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  // Only admins switch scope: the all-workspaces view lives under /admin, and
  // a user's Data Management page shows the one workspace they opened.
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === 'ADMIN'
  const [scope, setScope] = useState<Scope>(workspaceId || 'all')
  const [range, setRange] = useState<TimeRange>('24h')

  const {
    workspaces,
    kpis,
    tagHealth,
    trend,
    perWorkspace,
    noAccess,
    refetch,
  } = usePipelineAnalytics(scope, range)

  const handleScopeChange = (newScope: Scope) => {
    setScope(newScope)

    if (newScope === 'all') {
      router.push('/admin/analytics')
    } else {
      router.push(`/analytics/${newScope}`)
    }
  }

  // A user's workspace list holds only their own workspaces, so an id that is
  // not in it is one they are not a member of (a hand-typed URL).
  if (noAccess) {
    return (
      <Card className="flex flex-col items-start gap-4 border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          Workspace not found or you do not have access.
        </p>
        <Button asChild>
          <Link href="/workspaces">Back to Workspaces</Link>
        </Button>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <AnalyticsHeader
        workspaces={workspaces}
        showScopeSelect={isAdmin}
        scope={scope}
        onScopeChange={handleScopeChange}
        range={range}
        onRangeChange={setRange}
        onRefresh={refetch}
      />

      <PipelineKpiCards kpis={kpis} />

      <div className="grid gap-6 lg:grid-cols-3">
        <IngestionTrendChart data={trend} range={range} />
        <TagHealthDonut health={tagHealth} />
      </div>

      <QuickVisualizerPanel />

      <PipelineWorkspaceTable rows={perWorkspace} />
    </div>
  )
}
