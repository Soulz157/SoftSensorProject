'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePlantsData } from '@/hooks/use-plants-data'
import { PlantsMap } from './components/overview-map'
import { OverviewDetailPanel } from './components/overview-detail-panel'
import type { Workspace } from '@/types'

export default function PlantsPage() {
  const { workspaces, nodesByWorkspace, loading, error } = usePlantsData()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const router = useRouter()

  if (loading) return null
  if (error) throw new Error(error)

  const selectedWorkspace: Workspace | null =
    workspaces.find(w => w.id === selectedId) ?? null
  const selectedNodes = selectedId ? (nodesByWorkspace[selectedId] ?? []) : []

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Main canvas — flex-1 */}
      <div className="relative flex-1 overflow-hidden">
        {/* Page header — gradient scrim ensures readability on both dark/light map themes */}
        <div className="pointer-events-none absolute left-0 right-0 top-0 z-10 bg-linear-to-b from-black/50 to-transparent px-4 pb-6 pt-3">
          <h1 className="text-sm font-bold tracking-wide text-white drop-shadow">
            Workspaces Overview
          </h1>
          <p className="text-xs text-white/70 drop-shadow">
            {workspaces.length} plants monitored
          </p>
        </div>

        <PlantsMap
          workspaces={workspaces}
          nodesByWorkspace={nodesByWorkspace}
          selectedWorkspaceId={selectedId}
          onWorkspaceClick={id => setSelectedId(id === selectedId ? null : id)}
          onWorkspaceDoubleClick={id => router.push(`/plants/${id}`)}
        />
      </div>

      {/* Detail panel — 300px, slides in when selected */}
      {selectedWorkspace && (
        <div className="w-75 shrink-0 border-l border-border bg-background">
          <OverviewDetailPanel
            workspace={selectedWorkspace}
            nodes={selectedNodes}
            onClose={() => setSelectedId(null)}
            onViewWorkspace={id => router.push(`/plants/${id}`)}
            onOpenCanvas={id => router.push(`/workspaces/${id}/canvas`)}
            onViewAlerts={() => router.push('/alerts')}
          />
        </div>
      )}
    </div>
  )
}
