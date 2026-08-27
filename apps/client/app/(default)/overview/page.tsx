'use client'
import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { usePlantsData } from '@/hooks/plants/use-plants-data'
import { useAllModels } from '@/hooks/use-all-models'
import { failedDeploys, failedCountByNodeId } from '@/lib/model-status'

import { useWorkspaceFilter } from '@/hooks/workspace/use-workspace-filter'
import { useWorkspaceSelection } from '@/hooks/workspace/use-workspace-selection'

import { PlantsMap } from './components/overview-map'
import { OverviewSearch } from './components/overview-search'
import { OverviewDetailPanel } from './components/overview-detail-panel'
import { OverviewSkeleton } from './components/overview-skeleton'
import { CreateWorkspaceForm } from '@/components/auth/create-workspace-form'
import { useSearchParams } from 'next/navigation'
import { useAlerts } from '@/hooks/alerts/use-alerts'

export default function PlantsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const wsFromUrl = searchParams.get('ws')
  const { workspaces, nodesByWorkspace, loading, error } = usePlantsData()
  const { models } = useAllModels()
  const { alerts, loading: alertsLoading } = useAlerts()

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

  // Same two signals the navbar's alert count is built from (buildAlerts:
  // node hardware status in {alarm,offline,warning} + failed model
  // deploys) — BUG FIX: `AlertRow` has no `nodeId` field (node-kind rows
  // carry the node id as `id`), and `CanvasNode` has no top-level `status`
  // (it's `data.status`). Both were always `undefined`, so this Set was
  // always empty and every workspace/tower rendered 'normal' regardless of
  // real alerts — the mismatch against the navbar/sidebar alert counts.
  const abnormalNodeIds = useMemo(() => {
    const ids = new Set<string>()
    for (const a of alerts) {
      if (a.kind === 'node') ids.add(a.id)
    }
    for (const nodeId of Object.keys(failedByNodeId)) {
      ids.add(nodeId)
    }
    return ids
  }, [alerts, failedByNodeId])

  // roll up จาก nodes ที่ reconcile แล้ว — dot ใหญ่ + StatusIcon บน tower
  // อ่านจาก workspace.status ไม่ใช่จาก nodeStatuses จึงต้องคำนวณใหม่ด้วย
  //
  // Reads raw `nodesByWorkspace` directly (not a reconciled copy) — the map
  // and detail panel already read `node.data.status` themselves
  // (overview-map.tsx, overview-detail-panel.tsx), so a per-node
  // `{...n, status}` copy was dead weight nothing consumed, and its
  // mismatched shape is what produced the CanvasNode type errors.
  const workspacesReconciled = useMemo(
    () =>
      workspaces.map(ws => {
        const nodes = nodesByWorkspace[ws.id] ?? []
        const hasAlarm = nodes.some(
          n =>
            n.data.status === 'alarm' ||
            n.data.status === 'warning' ||
            abnormalNodeIds.has(n.id),
        )
        const allOffline =
          nodes.length > 0 && nodes.every(n => n.data.status === 'offline')
        const status: 'alarm' | 'offline' | 'normal' | 'warning' = hasAlarm
          ? 'alarm'
          : allOffline
            ? 'offline'
            : 'normal'

        return { ...ws, status }
      }),
    [workspaces, nodesByWorkspace, abnormalNodeIds],
  )

  const {
    filterQuery,
    setFilterQuery,
    filterStatuses,
    handleStatusToggle,
    handleClearAllStatuses,
    highlightedIds,
  } = useWorkspaceFilter(workspacesReconciled)

  const {
    selectedId,
    setSelectedId,
    selectedWorkspace,
    selectedNodes,
    panelRef,
    handleDismiss,
  } = useWorkspaceSelection(workspacesReconciled, nodesByWorkspace, wsFromUrl)

  const selectWorkspace = (id: string | null) => {
    setSelectedId(id)
  }

  const dismiss = () => {
    handleDismiss()
  }

  if (loading || alertsLoading) return <OverviewSkeleton />
  if (error) throw new Error(error)

  if (workspaces.length === 0)
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3">
        <CreateWorkspaceForm />
      </div>
    )

  return (
    <div className="flex h-full w-full overflow-hidden">
      <div className="relative flex-1 overflow-hidden">
        <div className="pointer-events-none absolute left-0 right-0 top-0 z-10 bg-linear-to-b dark:from-black/70 dark:to-black/55  px-4 pb-6 pt-3">
          <h1 className="text-sm font-semibold tracking-wide text-muted-foreground dark:text-white drop-shadow">
            Workspaces Overview
          </h1>
          <p className="text-xs text-muted-foreground  dark:text-white/70 drop-shadow">
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
          workspaces={workspacesReconciled}
          nodesByWorkspace={nodesByWorkspace}
          selectedWorkspaceId={selectedId}
          onWorkspaceClick={id =>
            selectWorkspace(id === selectedId ? null : id)
          }
          onWorkspaceDoubleClick={id => router.push(`/plants/${id}`)}
          highlightedIds={highlightedIds}
          failedDeploysByWorkspace={failedDeploysByWorkspace}
          failedByNodeId={failedByNodeId}
          abnormalNodeIds={abnormalNodeIds}
        />
      </div>

      {selectedWorkspace && (
        <>
          <div
            className="fixed inset-0 z-10 bg-black/30 sm:hidden"
            onClick={dismiss}
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
              onClose={dismiss}
              onViewWorkspace={id => router.push(`/plants/${id}`)}
              onOpenPipeEditor={id => router.push(`/workspaces/${id}/canvas`)}
              onViewAlerts={() => router.push('/alerts')}
              onOpenSettings={id => router.push(`/workspaces/${id}/settings`)}
            />
          </div>
        </>
      )}
    </div>
  )
}
