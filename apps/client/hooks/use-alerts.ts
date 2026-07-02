'use client'
import { useCallback, useMemo } from 'react'
import { useWorkspaces } from '@/hooks/workspace/use-workspaces'
import { useModelHierarchy } from '@/hooks/model/use-model-hierarchy'
import { useAllModels } from '@/hooks/use-all-models'
import { buildAlerts, type AlertRow } from '@/lib/alerts'

export interface UseAlertsResult {
  alerts: AlertRow[]
  loading: boolean
  isFetching: boolean
  error: string | null
  refetch: () => void
}

/**
 * Single data source for the `/alerts` page. Composes workspaces +
 * plant/node hierarchy + all models, then assembles the unified alert list
 * via the pure `buildAlerts` (see `lib/alerts.ts`). Page stays a thin shell.
 */
export function useAlerts(): UseAlertsResult {
  const { workspaces, loading: wsLoading } = useWorkspaces()
  const {
    plantsByWorkspaceId,
    nodesByWorkspaceId,
    loading: hierarchyLoading,
    isFetching: hierarchyFetching,
    error: hierarchyError,
    refetch: refetchHierarchy,
  } = useModelHierarchy()
  const {
    models,
    loading: modelsLoading,
    isFetching: modelsFetching,
    error: modelsError,
    refetch: refetchModels,
  } = useAllModels()

  const alerts = useMemo(
    () =>
      buildAlerts({
        workspaces,
        nodesByWorkspaceId,
        plantsByWorkspaceId,
        models: models ?? [],
      }),
    [workspaces, nodesByWorkspaceId, plantsByWorkspaceId, models],
  )

  const refetch = useCallback(() => {
    refetchHierarchy()
    refetchModels()
  }, [refetchHierarchy, refetchModels])

  return {
    alerts,
    loading: wsLoading || hierarchyLoading || modelsLoading,
    isFetching: hierarchyFetching || modelsFetching,
    error: hierarchyError ?? modelsError,
    refetch,
  }
}
