import { useState, useMemo, useEffect, useRef } from 'react'
import { useWorkspacePlants } from '../workspace/use-workspace-plants'
import { NodeStatus } from '@/store/status-colors'
import { useDashboardData } from '../use-dashboard-data'
import { createNode } from '@/services/canvas'
import { useModels } from '../workspace/use-models'
import { failedDeploys } from '@/lib/model-status'

type ViewMode = 'plants' | 'equipment'
type DisplayMode = 'map' | 'grid'

export function usePlantsController(
  initialWorkspaceId: string,
  initialNodeId?: string | null,
) {
  const { workspaces, nodes, loading, error, refetch } = useDashboardData()

  const [viewMode, setViewMode] = useState<ViewMode>('plants')
  const [displayMode, setDisplayMode] = useState<DisplayMode>('map')
  const [selectedWorkspaceId] = useState<string | null>(initialWorkspaceId)
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [statusFilter] = useState<NodeStatus | null>(null)
  const [isAddPlanOpen, setIsAddPlanOpen] = useState(false)
  const [isAddEquipmentOpen, setIsAddEquipmentOpen] = useState(false)
  const [isPanelOpen, setIsPanelOpen] = useState(false)

  const activeWorkspaceId =
    selectedWorkspaceId ?? initialWorkspaceId ?? workspaces[0]?.id ?? null
  const { plants, createPlan } = useWorkspacePlants(activeWorkspaceId)

  const { data: modelsRaw } = useModels(activeWorkspaceId)

  const failedNodeIds = useMemo(
    () =>
      new Set(
        failedDeploys(modelsRaw ?? [])
          .map(m => m.nodesId)
          .filter((id): id is string => id !== null),
      ),
    [modelsRaw],
  )

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

  const deepLinkApplied = useRef(false)
  useEffect(() => {
    if (deepLinkApplied.current || !initialNodeId || nodes.length === 0) return
    const node = nodes.find(n => n.id === initialNodeId)
    if (!node) return
    deepLinkApplied.current = true
    setSelectedNodeId(node.id)
    if (node.planId) {
      setSelectedPlanId(node.planId)
      setViewMode('equipment')
    }
    setIsPanelOpen(true)
  }, [initialNodeId, nodes])

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

  const workspaceNodes = useMemo(() => {
    if (!activeWorkspaceId) return nodes
    return nodes.filter(n => n.workspaceId === activeWorkspaceId)
  }, [nodes, activeWorkspaceId])

  const visibleGridNodes = useMemo(() => {
    if (viewMode === 'equipment' && selectedPlanId) return filteredNodes
    if (activeWorkspaceId)
      return nodes.filter(n => n.workspaceId === activeWorkspaceId)
    return nodes
  }, [filteredNodes, nodes, selectedPlanId, activeWorkspaceId, viewMode])

  const { alarmCount, warningCount, deployFailedCount } = useMemo(() => {
    return visibleGridNodes.reduce(
      (acc, node) => {
        if (node.data.status === 'alarm') acc.alarmCount++
        if (node.data.status === 'warning') acc.warningCount++
        if (failedNodeIds.has(node.id)) acc.deployFailedCount++
        return acc
      },
      { alarmCount: 0, warningCount: 0, deployFailedCount: 0 },
    )
  }, [visibleGridNodes, failedNodeIds])

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
      handleAddEquipment: async (
        name: string,
        type: 'machine' | 'sensor' | 'controller',
      ) => {
        if (!activeWorkspaceId || !selectedPlanId) return
        await createNode(activeWorkspaceId, selectedPlanId, {
          name,
          type,
          status: 'normal',
          x: 0,
          y: 0,
        })
        refetch()
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
      handleOpenAddEquipment: () => setIsAddEquipmentOpen(true),
      handleCloseAddEquipment: () => setIsAddEquipmentOpen(false),
    }),
    [
      selectedPlanId,
      selectedNodeId,
      viewMode,
      createPlan,
      activeWorkspaceId,
      refetch,
    ],
  )

  return {
    state: {
      viewMode,
      displayMode,
      isAddPlanOpen,
      isAddEquipmentOpen,
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
      workspaceNodes,
      visibleGridNodes,
      selectedPlan,
      selectedNode,
      selectedWorkspace,
      breadcrumbPlant,
      alarmCount,
      warningCount,
      deployFailedCount,
      failedNodeIds,
    },
    setters: {
      setDisplayMode,
    },
    handlers,
  }
}
