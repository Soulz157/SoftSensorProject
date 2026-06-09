'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePlantsData } from '@/hooks/use-plants-data'
import { PlantsMap } from './components/plants-map'
import { PlantDetailPanel } from './components/plant-detail-panel'
import type { Workspace } from '@/types'

export default function PlantsPage() {
  const { workspaces, nodesByWorkspace, loading, error } = usePlantsData()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const router = useRouter()

  if (loading) return null // loading.tsx handles the skeleton
  if (error) throw new Error(error) // error.tsx handles this

  const selectedWorkspace: Workspace | null =
    workspaces.find(w => w.id === selectedId) ?? null
  const selectedNodes = selectedId ? (nodesByWorkspace[selectedId] ?? []) : []

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Main canvas — flex-1 */}
      <div className="relative flex-1 overflow-hidden">
        {/* Page header */}
        <div className="pointer-events-none absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-4 py-3">
          <div>
            <h1 className="text-sm font-bold tracking-wide text-white/90">
              Plants Overview
            </h1>
            <p className="text-xs text-white/50">
              {workspaces.length} plants monitored
            </p>
          </div>
        </div>

        <PlantsMap
          workspaces={workspaces}
          nodesByWorkspace={nodesByWorkspace}
          selectedWorkspaceId={selectedId}
          onWorkspaceClick={id => setSelectedId(id === selectedId ? null : id)}
          onWorkspaceDoubleClick={id => router.push(`/workspaces/${id}`)}
        />
      </div>

      {/* Detail panel — 300px, slides in when selected */}
      {selectedWorkspace && (
        <div className="w-[300px] shrink-0 border-l border-border bg-background">
          <PlantDetailPanel
            workspace={selectedWorkspace}
            nodes={selectedNodes}
            onClose={() => setSelectedId(null)}
            onViewWorkspace={id => router.push(`/workspaces/${id}`)}
            onOpenCanvas={id => router.push(`/workspaces/${id}/canvas`)}
            onViewAlerts={() => router.push('/alerts')}
          />
        </div>
      )}
    </div>
  )
}
