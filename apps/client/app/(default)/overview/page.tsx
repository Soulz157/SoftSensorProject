'use client'
import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { usePlantsData } from '@/hooks/use-plants-data'
import { useAllModels } from '@/hooks/use-all-models'
import { failedDeploys, failedCountByNodeId } from '@/lib/model-status'

import { useWorkspaceFilter } from '@/hooks/workspace/use-workspace-filter'
import { useWorkspaceSelection } from '@/hooks/workspace/use-workspace-selection'

import { PlantsMap } from './components/overview-map'
import { OverviewSearch } from './components/overview-search'
import { OverviewDetailPanel } from './components/overview-detail-panel'
import { OverviewSkeleton } from './components/overview-skeleton'

export default function PlantsPage() {
  const router = useRouter()
  const { workspaces, nodesByWorkspace, loading, error } = usePlantsData()
  const { models } = useAllModels()

  const failedDeploysByWorkspace = useMemo(() => {
    if (!models) return {}
    const map: Record<string, number> = {}
    for (const m of failedDeploys(models)) {
      map[m.workspaceId] = (map[m.workspaceId] ?? 0) + 1
    }
    return map
  }, [models])

  const failedByNodeId = useMemo(
    () => (models ? failedCountByNodeId(models) : {}),
    [models],
  )

  const {
    filterQuery,
    setFilterQuery,
    filterStatuses,
    handleStatusToggle,
    handleClearAllStatuses,
    highlightedIds,
  } = useWorkspaceFilter(workspaces)

  const {
    selectedId,
    setSelectedId,
    selectedWorkspace,
    selectedNodes,
    panelRef,
    handleDismiss,
  } = useWorkspaceSelection(workspaces, nodesByWorkspace)

  if (loading) return <OverviewSkeleton />
  if (error) throw new Error(error)

  if (workspaces.length === 0)
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3">
        <p className="text-sm font-medium text-foreground">No workspaces yet</p>
        <p className="text-xs text-muted-foreground">
          Create a workspace to start monitoring.
        </p>
      </div>
    )

  return (
    <div className="flex h-full w-full overflow-hidden">
      <div className="relative flex-1 overflow-hidden">
        <div className="pointer-events-none absolute left-0 right-0 top-0 z-10 bg-linear-to-b from-black/50 to-transparent px-4 pb-6 pt-3">
          <h1 className="text-sm font-semibold tracking-wide text-white drop-shadow">
            Workspaces Overview
          </h1>
          <p className="text-xs text-white/70 drop-shadow">
            {workspaces.length} workspaces monitored
          </p>
        </div>

        <div className="pointer-events-auto absolute left-1/2 top-14 z-20 w-full max-w-md -translate-x-1/2 px-4">
          <OverviewSearch
            query={filterQuery}
            onQueryChange={setFilterQuery}
            activeStatuses={filterStatuses}
            onStatusToggle={handleStatusToggle}
            onClearAllStatuses={handleClearAllStatuses}
          />
        </div>

        <PlantsMap
          workspaces={workspaces}
          nodesByWorkspace={nodesByWorkspace}
          selectedWorkspaceId={selectedId}
          onWorkspaceClick={id => setSelectedId(id === selectedId ? null : id)}
          onWorkspaceDoubleClick={id => router.push(`/plants/${id}`)}
          highlightedIds={highlightedIds}
          failedDeploysByWorkspace={failedDeploysByWorkspace}
          failedByNodeId={failedByNodeId}
        />
      </div>

      {selectedWorkspace && (
        <>
          <div
            className="fixed inset-0 z-10 bg-black/30 sm:hidden"
            onClick={handleDismiss}
            aria-hidden="true"
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedWorkspace.name} — plant details`}
            tabIndex={-1}
            className="fixed inset-x-0 bottom-0 z-20 h-[65svh] overflow-hidden rounded-t-2xl outline-none sm:relative sm:inset-auto sm:z-auto sm:h-full sm:rounded-none"
          >
            <OverviewDetailPanel
              workspace={selectedWorkspace}
              nodes={selectedNodes}
              onClose={handleDismiss}
              onViewWorkspace={id => router.push(`/plants/${id}`)}
              onOpenPipeEditor={id => router.push(`/workspaces/${id}/canvas`)}
              onViewAlerts={() => router.push('/alerts')}
            />
          </div>
        </>
      )}
    </div>
  )
}
