'use client'
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { usePlantsData } from '@/hooks/use-plants-data'
import { PlantsMap } from './components/overview-map'
import { OverviewSearch } from './components/overview-search'
import { OverviewDetailPanel } from './components/overview-detail-panel'
import type { Workspace } from '@/types'
import { type NodeStatus } from '@/lib/overview-status'

export default function PlantsPage() {
  const { workspaces, nodesByWorkspace, loading, error } = usePlantsData()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const router = useRouter()
  const panelRef = useRef<HTMLDivElement>(null)

  const handleDismiss = useCallback(() => setSelectedId(null), [])

  const [filterQuery, setFilterQuery] = useState('')
  const [filterStatuses, setFilterStatuses] = useState<NodeStatus[]>([])

  const handleStatusToggle = useCallback(
    (s: NodeStatus) =>
      setFilterStatuses(prev =>
        prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s],
      ),
    [],
  )

  const highlightedIds = useMemo(() => {
    if (!filterQuery && filterStatuses.length === 0) return undefined
    const q = filterQuery.toLowerCase()
    return new Set(
      workspaces
        .filter(ws => {
          const nameMatch = !q || ws.name.toLowerCase().includes(q)
          if (!nameMatch) return false
          if (filterStatuses.length === 0) return true
          return filterStatuses.includes((ws.status ?? 'normal') as NodeStatus)
        })
        .map(ws => ws.id),
    )
  }, [filterQuery, filterStatuses, workspaces])

  useEffect(() => {
    if (selectedId) panelRef.current?.focus()
  }, [selectedId])

  useEffect(() => {
    if (!selectedId) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleDismiss()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [selectedId, handleDismiss])

  if (loading)
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading workspaces"
        className="flex h-full w-full motion-safe:animate-pulse items-center justify-center bg-muted/10"
      >
        <p className="text-sm text-muted-foreground">Loading workspaces…</p>
      </div>
    )
  if (error) throw new Error(error)

  const selectedWorkspace: Workspace | null =
    workspaces.find(w => w.id === selectedId) ?? null
  const selectedNodes = selectedId ? (nodesByWorkspace[selectedId] ?? []) : []

  if (workspaces.length === 0)
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3">
        <p className="text-sm font-medium text-foreground">No workspaces yet</p>
        <p className="text-xs text-muted-foreground">
          Create a workspace to start monitoring your plant.
        </p>
      </div>
    )

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Main canvas — flex-1 */}
      <div className="relative flex-1 overflow-hidden">
        <div className="pointer-events-none absolute left-0 right-0 top-0 z-10 bg-linear-to-b from-black/50 to-transparent px-4 pb-6 pt-3">
          <h1 className="text-sm font-semibold tracking-wide text-white drop-shadow">
            Workspaces Overview
          </h1>
          <p className="text-xs text-white/70 drop-shadow">
            {workspaces.length} plants monitored
          </p>
        </div>

        {/* Search + filter bar — centered below title, above map controls */}
        <div className="pointer-events-auto absolute left-1/2 top-14 z-20 w-full max-w-md -translate-x-1/2 px-4">
          <OverviewSearch
            query={filterQuery}
            onQueryChange={setFilterQuery}
            activeStatuses={filterStatuses}
            onStatusToggle={handleStatusToggle}
          />
        </div>

        <PlantsMap
          workspaces={workspaces}
          nodesByWorkspace={nodesByWorkspace}
          selectedWorkspaceId={selectedId}
          onWorkspaceClick={id => setSelectedId(id === selectedId ? null : id)}
          onWorkspaceDoubleClick={id => router.push(`/plants/${id}`)}
          highlightedIds={highlightedIds}
        />
      </div>

      {/* Detail panel — side panel on sm+, bottom sheet on mobile */}
      {selectedWorkspace && (
        <>
          {/* Mobile: tap-outside backdrop */}
          <div
            className="fixed inset-0 z-10 bg-black/30 sm:hidden"
            onClick={handleDismiss}
            aria-hidden="true"
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedWorkspace.name} — workspace details`}
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
