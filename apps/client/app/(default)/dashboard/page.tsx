'use client'
import { useState, useMemo, useCallback } from 'react'
import { ChevronLeft } from 'lucide-react'
import { IsometricMap } from './components/isometric-map'
import { NodeDetailPanel } from './components/node-detail-panel'
import { MachineLegend } from './components/machine-legend'
import { useDashboardData } from '../../../hooks/use-dashboard-data'
import { useWorkspacePlans } from '../../../hooks/workspace/use-workspace-plans'
import type { NodeStatus } from '../../../store/status-colors'

export default function DashboardPage() {
  const { workspaces, nodes, loading, error } = useDashboardData()

  const [viewMode, setViewMode] = useState<'plans' | 'equipment'>('plans')
  const [selectedWorkspaceId] = useState<string | null>(
    workspaces[0]?.id ?? null,
  )
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [statusFilter] = useState<NodeStatus | null>(null)

  const { plans } = useWorkspacePlans(selectedWorkspaceId)

  const selectedPlan = useMemo(
    () => plans.find(p => p.id === selectedPlanId) ?? null,
    [plans, selectedPlanId],
  )

  const selectedNode = useMemo(
    () => nodes.find(n => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  )

  const filteredNodes = useMemo(() => {
    let result = nodes
    if (statusFilter)
      result = result.filter(n => n.data.status === statusFilter)
    if (viewMode === 'equipment' && selectedPlanId) {
      result = result.filter(n => n.planId === selectedPlanId)
    }
    return result
  }, [nodes, statusFilter, viewMode, selectedPlanId])

  const handleDrillDown = useCallback((planId: string) => {
    setSelectedPlanId(planId)
    setSelectedNodeId(null)
    setViewMode('equipment')
  }, [])

  const handleBack = useCallback(() => {
    setViewMode('plans')
    setSelectedNodeId(null)
  }, [])

  const handleZoneSelect = useCallback(
    (id: string) => {
      if (viewMode === 'plans') {
        setSelectedPlanId(prev => (prev === id ? null : id))
      }
    },
    [viewMode],
  )

  const selectedWorkspace = workspaces.find(w => w.id === selectedWorkspaceId)

  if (loading) return null

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-destructive">
        {error}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {viewMode === 'equipment' && selectedPlan && (
        <div className="flex items-center gap-2 border-b border-border bg-[#0d1018] px-4 py-2">
          <button
            onClick={handleBack}
            className="flex items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="h-3 w-3" />
            Back
          </button>
          <span className="text-[10px] text-muted-foreground/40">/</span>
          {selectedWorkspace && (
            <>
              <span className="text-[10px] text-muted-foreground">
                {selectedWorkspace.name}
              </span>
              <span className="text-[10px] text-muted-foreground/40">/</span>
            </>
          )}
          <span className="text-[10px] font-semibold text-foreground">
            {selectedPlan.name}
          </span>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-hidden">
          <IsometricMap
            zones={
              viewMode === 'plans' ? plans : selectedPlan ? [selectedPlan] : []
            }
            nodes={filteredNodes}
            zoneNodeKey={viewMode === 'plans' ? 'planId' : 'planId'}
            selectedZoneId={
              viewMode === 'plans' ? selectedPlanId : selectedPlanId
            }
            selectedNodeId={selectedNodeId}
            onZoneSelect={handleZoneSelect}
            onNodeClick={id =>
              setSelectedNodeId(prev => (prev === id ? null : id))
            }
          />
        </main>
        <NodeDetailPanel
          viewMode={viewMode}
          node={selectedNode}
          plan={selectedPlan}
          workspaceId={selectedWorkspaceId}
          onDrillDown={handleDrillDown}
        />
      </div>
      <MachineLegend />
    </div>
  )
}
