'use client'

import { useMemo } from 'react'
import { useWorkspaces } from '@/hooks/workspace/use-workspaces'
import {
  ingestionTrendSeries,
  perWorkspacePipeline,
  pipelineKpis,
  tagHealthBreakdown,
  type IngestionPoint,
  type PipelineKpis,
  type Scope,
  type TagHealth,
  type WorkspacePipelineRow,
} from '@/lib/pipeline-metrics'
import type { TimeRange } from '@/lib/mock-readings'
import type { Workspace } from '@/types'

export interface UsePipelineAnalyticsResult {
  workspaces: Workspace[]
  kpis: PipelineKpis
  tagHealth: TagHealth
  trend: IngestionPoint[]
  perWorkspace: WorkspacePipelineRow[]
  loading: boolean
  refetch: () => void
}

/**
 * Pipeline analytics for the Analytics command center.
 *
 * Loads the real workspace list (`useWorkspaces`) and derives every pipeline
 * figure for the current `scope` + `range` via the pure
 * `lib/pipeline-metrics.ts` helpers — no fetch logic or derivation lives in the
 * page/components (business-logic split rule).
 */
export function usePipelineAnalytics(
  scope: Scope,
  range: TimeRange,
): UsePipelineAnalyticsResult {
  const { workspaces, loading, refetch } = useWorkspaces()

  const kpis = useMemo(
    () => pipelineKpis(scope, range, workspaces),
    [scope, range, workspaces],
  )
  const tagHealth = useMemo(
    () => tagHealthBreakdown(scope, workspaces),
    [scope, workspaces],
  )
  const trend = useMemo(
    () => ingestionTrendSeries(scope, range),
    [scope, range],
  )
  const perWorkspace = useMemo(
    () => perWorkspacePipeline(workspaces),
    [workspaces],
  )

  return { workspaces, kpis, tagHealth, trend, perWorkspace, loading, refetch }
}
