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
import { useRouter } from 'next/navigation'

export function AnalyticsDashboard({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const [scope, setScope] = useState<Scope>(workspaceId || 'all')
  const [range, setRange] = useState<TimeRange>('24h')

  const { workspaces, kpis, tagHealth, trend, perWorkspace, refetch } =
    usePipelineAnalytics(scope, range)

  const handleScopeChange = (newScope: Scope) => {
    setScope(newScope)

    if (newScope === 'all') {
      router.push('/analytics')
    } else {
      router.push(`/analytics/${newScope}`)
    }
  }

  return (
    <div className="space-y-6">
      <AnalyticsHeader
        workspaces={workspaces}
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
