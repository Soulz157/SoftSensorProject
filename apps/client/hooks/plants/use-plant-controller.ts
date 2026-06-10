import { useState, useMemo } from 'react'
import { useWorkspacePlants } from '../workspace/use-workspace-plants'
import { NodeStatus } from '@/store/status-colors'
import { useDashboardData } from '../use-dashboard-data'

type ViewMode = 'plants' | 'equipment'
type DisplayMode = 'map' | 'grid'

export function usePlantsController(initialWorkspaceId: string) {
  const { workspaces, nodes, loading, error } = useDashboardData()

  const [viewMode, setViewMode] = useState<ViewMode>('plants')
  const [displayMode, setDisplayMode] = useState<DisplayMode>('map')
  const [selectedWorkspaceId] = useState<string | null>(initialWorkspaceId)
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [statusFilter] = useState<NodeStatus | null>(null)
  const [isAddPlanOpen, setIsAddPlanOpen] = useState(false)
  const [isPanelOpen, setIsPanelOpen] = useState(false)

  const activeWorkspaceId =
    selectedWorkspaceId ?? initialWorkspaceId ?? workspaces[0]?.id ?? null
  const { plants, createPlan } = useWorkspacePlants(activeWorkspaceId)

  const selectedPlan = useMemo(
    () => plants.find(p => p.id === selectedPlanId) ?? null,
    [plants, selectedPlanId],
  )
  const selectedNode = useMemo(
    () => nodes.find(n => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  )
  const selectedWorkspace = workspaces.find(w => w.id === activeWorkspaceId)
  const selectedNodePlan = useMemo(
    () => plants.find(p => p.id === selectedNode?.planId) ?? null,
    [plants, selectedNode],
  )

  const breadcrumbPlant = selectedPlan ?? selectedNodePlan
  const inspectorMode: ViewMode = selectedNode ? 'equipment' : viewMode

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

  const handlers = useMemo(
    () => ({
      handleDrillDown: (planId: string) => {
        setSelectedPlanId(planId)
        setSelectedNodeId(null)
        setViewMode('equipment')
        setIsPanelOpen(true)
      },
      handleBack: () => {
        setViewMode('plants')
        setSelectedNodeId(null)
        setSelectedPlanId(null)
        setIsPanelOpen(false)
      },
      handleZoneSelect: (planId: string) => {
        if (viewMode === 'plants') {
          const isDeselecting = selectedPlanId === planId
          setSelectedPlanId(isDeselecting ? null : planId)
          setSelectedNodeId(null)
          setIsPanelOpen(!isDeselecting)
        }
      },
      handleNodeClick: (nodeId: string) => {
        const isDeselecting = selectedNodeId === nodeId
        setSelectedNodeId(isDeselecting ? null : nodeId)
        setIsPanelOpen(!isDeselecting)
      },
      handleCreatePlan: async (name: string) => {
        await createPlan({ name })
      },
      handleResetToPlantsView: () => {
        setViewMode('plants')
        setSelectedPlanId(null)
        setSelectedNodeId(null)
        setIsPanelOpen(false)
      },
      handleResetToEquipmentView: () => {
        setSelectedNodeId(null)
        setViewMode('equipment')
        setIsPanelOpen(false)
      },
      handleClosePanel: () => setIsPanelOpen(false),
      handleOpenAddPlan: () => setIsAddPlanOpen(true),
      handleCloseAddPlan: () => setIsAddPlanOpen(false),
    }),
    [selectedPlanId, selectedNodeId, viewMode, createPlan],
  )

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
      plants,
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
