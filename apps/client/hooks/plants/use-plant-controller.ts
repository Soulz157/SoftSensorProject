import { useState, useMemo, useCallback, useEffect } from 'react'
import { useWorkspacePlans } from '../workspace/use-workspace-plans'
import { NodeStatus } from '@/store/status-colors'
import { useDashboardData } from '../use-dashboard-data'

type ViewMode = 'plants' | 'equipment'
type DisplayMode = 'map' | 'grid'

export function usePlantsController(initialWorkspaceId: string) {
  const { workspaces, nodes, loading, error } = useDashboardData()

  const [viewMode, setViewMode] = useState<ViewMode>('plants')
  const [displayMode, setDisplayMode] = useState<DisplayMode>('map')
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    initialWorkspaceId,
  )
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [statusFilter] = useState<NodeStatus | null>(null)
  const [isAddPlanOpen, setIsAddPlanOpen] = useState(false)
  const [isPanelOpen, setIsPanelOpen] = useState(false)

  const activeWorkspaceId =
    selectedWorkspaceId ?? initialWorkspaceId ?? workspaces[0]?.id ?? null
  const { plans, createPlan } = useWorkspacePlans(activeWorkspaceId)

  const selectedPlan = useMemo(
    () => plans.find(p => p.id === selectedPlanId) ?? null,
    [plans, selectedPlanId],
  )
  const selectedNode = useMemo(
    () => nodes.find(n => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  )
  const selectedWorkspace = workspaces.find(w => w.id === activeWorkspaceId)
  const selectedNodePlan = useMemo(
    () => plans.find(p => p.id === selectedNode?.planId) ?? null,
    [plans, selectedNode],
  )

  const breadcrumbPlant = selectedPlan ?? selectedNodePlan
  const inspectorMode: ViewMode = selectedNode ? 'equipment' : viewMode

  // 4. Effects
  useEffect(() => {
    if (selectedNode || selectedPlan) setIsPanelOpen(true)
  }, [selectedNode, selectedPlan])

  // 5. Data Processing (Filtering)
  const filteredNodes = useMemo(() => {
    let result = nodes
    if (statusFilter)
      result = result.filter(n => n.data.status === statusFilter)
    if (viewMode === 'equipment' && selectedPlanId) {
      result = result.filter(n => n.planId === selectedPlanId)
    } else if (viewMode === 'plants' && activeWorkspaceId) {
      result = result.filter(n => n.workspaceId === activeWorkspaceId)
    }
    return result
  }, [nodes, statusFilter, viewMode, selectedPlanId, activeWorkspaceId])

  const visibleGridNodes = useMemo(() => {
    if (viewMode === 'equipment' && selectedPlanId) return filteredNodes
    if (activeWorkspaceId)
      return nodes.filter(n => n.workspaceId === activeWorkspaceId)
    return nodes
  }, [filteredNodes, nodes, selectedPlanId, activeWorkspaceId, viewMode])

  const { alarmCount, warningCount } = useMemo(() => {
    return visibleGridNodes.reduce(
      (acc, node) => {
        if (node.data.status === 'alarm') acc.alarmCount++
        if (node.data.status === 'warning') acc.warningCount++
        return acc
      },
      { alarmCount: 0, warningCount: 0 },
    )
  }, [visibleGridNodes])

  // 6. Actions (Handlers)
  const handlers = {
    handleDrillDown: useCallback((planId: string) => {
      setSelectedPlanId(planId)
      setSelectedNodeId(null)
      setViewMode('equipment')
    }, []),
    handleBack: useCallback(() => {
      setViewMode('plants')
      setSelectedNodeId(null)
      setSelectedPlanId(null)
    }, []),
    handleZoneSelect: useCallback(
      (planId: string) => {
        if (viewMode === 'plants') {
          setSelectedPlanId(prev => (prev === planId ? null : planId))
          setSelectedNodeId(null)
        }
      },
      [viewMode],
    ),
    handleNodeClick: useCallback((nodeId: string) => {
      setSelectedNodeId(prev => (prev === nodeId ? null : nodeId))
    }, []),
    handleCreatePlan: useCallback(
      async (name: string) => {
        await createPlan({ name })
      },
      [createPlan],
    ),
    handleResetToPlantsView: useCallback(() => {
      setViewMode('plants')
      setSelectedPlanId(null)
      setSelectedNodeId(null)
    }, []),
    handleResetToEquipmentView: useCallback(() => {
      setSelectedNodeId(null)
      setViewMode('equipment')
    }, []),
    handleClosePanel: useCallback(() => setIsPanelOpen(false), []),
    handleOpenAddPlan: useCallback(() => setIsAddPlanOpen(true), []),
    handleCloseAddPlan: useCallback(() => setIsAddPlanOpen(false), []),
  }

  // 7. Return Everything needed for UI
  return {
    state: {
      viewMode,
      displayMode,
      isAddPlanOpen,
      isPanelOpen,
      selectedPlanId,
      selectedNodeId,
      activeWorkspaceId,
      inspectorMode,
    },
    data: {
      loading,
      error,
      plans,
      filteredNodes,
      visibleGridNodes,
      selectedPlan,
      selectedNode,
      selectedWorkspace,
      breadcrumbPlant,
      alarmCount,
      warningCount,
    },
    setters: {
      setDisplayMode,
    },
    handlers,
  }
}
