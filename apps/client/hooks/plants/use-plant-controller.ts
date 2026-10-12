import { useState, useMemo } from 'react'
import { useWorkspacePlants } from '../workspace/use-workspace-plants'
import { NodeStatus } from '@/store/status-colors'
import { useDashboardData } from '../use-dashboard-data'
import {
  createNode,
  deleteNode,
  updateNode,
  type EquipmentFormValues,
} from '@/services/canvas'
import { toast } from 'sonner'
import { useModels } from '../workspace/use-models'
import {
  abnormalModelCountByEquipmentId,
  failedDeploys,
} from '@/lib/model-status'

type ViewMode = 'plants' | 'equipment'
type DisplayMode = 'map' | 'grid'

export function usePlantsController(
  initialWorkspaceId: string,
  initialEquipmentId?: string | null,
) {
  const { workspaces, equipmentList, loading, error, refetch } =
    useDashboardData()

  const [viewMode, setViewMode] = useState<ViewMode>('plants')
  const [displayMode, setDisplayMode] = useState<DisplayMode>('map')
  const [selectedWorkspaceId] = useState<string | null>(initialWorkspaceId)
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<string | null>(
    null,
  )
  const [statusFilter] = useState<NodeStatus | null>(null)
  const [isAddPlanOpen, setIsAddPlanOpen] = useState(false)
  const [isAddEquipmentOpen, setIsAddEquipmentOpen] = useState(false)
  // MODEL-SERVE-025-D02. Equipment being edited in the shared Add/Edit form;
  // null = the form is in add mode (or closed).
  const [editingEquipmentId, setEditingEquipmentId] = useState<string | null>(
    null,
  )
  const [isPanelOpen, setIsPanelOpen] = useState(false)

  const activeWorkspaceId =
    selectedWorkspaceId ?? initialWorkspaceId ?? workspaces[0]?.id ?? null
  const { plants, createPlan } = useWorkspacePlants(activeWorkspaceId)

  const { data: modelsRaw } = useModels(activeWorkspaceId)

  const failedEquipmentIds = useMemo(
    () =>
      new Set(
        failedDeploys(modelsRaw ?? [])
          .map(m => m.nodesId)
          .filter((id): id is string => id !== null),
      ),
    [modelsRaw],
  )
  // MODEL-SERVE-024-D02. Equipment carrying an abnormal model (failed deploy
  // or monitoring ALERT) — Abnormal on the plant map even when the node's own
  // status is normal.
  const abnormalModelEquipmentIds = useMemo(
    () =>
      new Set(Object.keys(abnormalModelCountByEquipmentId(modelsRaw ?? []))),
    [modelsRaw],
  )

  const selectedPlan = useMemo(
    () => plants.find(p => p.id === selectedPlanId) ?? null,
    [plants, selectedPlanId],
  )
  const selectedEquipment = useMemo(
    () => equipmentList.find(n => n.id === selectedEquipmentId) ?? null,
    [equipmentList, selectedEquipmentId],
  )
  const selectedWorkspace = workspaces.find(w => w.id === activeWorkspaceId)
  const selectedEquipmentPlan = useMemo(
    () => plants.find(p => p.id === selectedEquipment?.planId) ?? null,
    [plants, selectedEquipment],
  )

  // Deep link applied once, as soon as its node has loaded — during render
  // (React's "storing information from previous renders" pattern), so the
  // first frame with nodes already shows the selection.
  const [deepLinkApplied, setDeepLinkApplied] = useState(false)
  const deepLinkEquipment =
    !deepLinkApplied && initialEquipmentId
      ? equipmentList.find(n => n.id === initialEquipmentId)
      : undefined
  if (deepLinkEquipment) {
    setDeepLinkApplied(true)
    setSelectedEquipmentId(deepLinkEquipment.id)
    if (deepLinkEquipment.planId) {
      setSelectedPlanId(deepLinkEquipment.planId)
      setViewMode('equipment')
    }
    setIsPanelOpen(true)
  }

  const breadcrumbPlant = selectedPlan ?? selectedEquipmentPlan
  const inspectorMode: ViewMode = selectedEquipment ? 'equipment' : viewMode

  const filteredEquipmentList = useMemo(() => {
    let result = equipmentList
    if (statusFilter)
      result = result.filter(n => n.data.status === statusFilter)
    if (viewMode === 'equipment' && selectedPlanId) {
      result = result.filter(n => n.planId === selectedPlanId)
    } else if (viewMode === 'plants' && activeWorkspaceId) {
      result = result.filter(n => n.workspaceId === activeWorkspaceId)
    }
    return result
  }, [equipmentList, statusFilter, viewMode, selectedPlanId, activeWorkspaceId])

  const workspaceEquipmentList = useMemo(() => {
    if (!activeWorkspaceId) return equipmentList
    return equipmentList.filter(n => n.workspaceId === activeWorkspaceId)
  }, [equipmentList, activeWorkspaceId])

  const visibleGridEquipmentList = useMemo(() => {
    if (viewMode === 'equipment' && selectedPlanId) return filteredEquipmentList
    if (activeWorkspaceId)
      return equipmentList.filter(n => n.workspaceId === activeWorkspaceId)
    return equipmentList
  }, [
    filteredEquipmentList,
    equipmentList,
    selectedPlanId,
    activeWorkspaceId,
    viewMode,
  ])

  const { alarmCount, warningCount, deployFailedCount } = useMemo(() => {
    return visibleGridEquipmentList.reduce(
      (acc, equipment) => {
        if (equipment.data.status === 'alarm') acc.alarmCount++
        if (equipment.data.status === 'warning') acc.warningCount++
        if (failedEquipmentIds.has(equipment.id)) acc.deployFailedCount++
        return acc
      },
      { alarmCount: 0, warningCount: 0, deployFailedCount: 0 },
    )
  }, [visibleGridEquipmentList, failedEquipmentIds])

  const handlers = useMemo(
    () => ({
      handleDrillDown: (planId: string) => {
        setSelectedPlanId(planId)
        setSelectedEquipmentId(null)
        setViewMode('equipment')
        setIsPanelOpen(true)
      },
      handleBack: () => {
        setViewMode('plants')
        setSelectedEquipmentId(null)
        setSelectedPlanId(null)
        setIsPanelOpen(false)
      },
      handleZoneSelect: (planId: string) => {
        if (viewMode === 'plants') {
          const isDeselecting = selectedPlanId === planId
          setSelectedPlanId(isDeselecting ? null : planId)
          setSelectedEquipmentId(null)
          setIsPanelOpen(!isDeselecting)
        }
      },
      handleEquipmentClick: (equipmentId: string) => {
        const isDeselecting = selectedEquipmentId === equipmentId
        setSelectedEquipmentId(isDeselecting ? null : equipmentId)
        setIsPanelOpen(!isDeselecting)
      },
      handleCreatePlan: async (name: string) => {
        await createPlan({ name })
      },
      handleAddEquipment: async (values: EquipmentFormValues) => {
        if (!activeWorkspaceId || !selectedPlanId) return
        await createNode(activeWorkspaceId, selectedPlanId, {
          name: values.name,
          type: values.type,
          // A new equipment always starts Normal (the form offers status
          // only when editing).
          status: 'normal',
          x: 0,
          y: 0,
        })
        refetch()
      },
      handleEditEquipment: async (values: EquipmentFormValues) => {
        if (!editingEquipmentId) return
        try {
          await updateNode(editingEquipmentId, values)
          toast.success('Equipment updated')
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : 'Failed to update equipment',
          )
          throw err
        }
        refetch()
      },
      handleDeleteEquipment: async (equipmentId: string) => {
        try {
          await deleteNode(equipmentId)
          toast.success('Equipment deleted')
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : 'Failed to delete equipment',
          )
          return
        }
        setSelectedEquipmentId(null)
        setIsPanelOpen(false)
        refetch()
      },
      handleOpenEditEquipment: (equipmentId: string) =>
        setEditingEquipmentId(equipmentId),
      handleCloseEditEquipment: () => setEditingEquipmentId(null),
      handleResetToPlantsView: () => {
        setViewMode('plants')
        setSelectedPlanId(null)
        setSelectedEquipmentId(null)
        setIsPanelOpen(false)
      },
      handleResetToEquipmentView: () => {
        setSelectedEquipmentId(null)
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
      selectedEquipmentId,
      viewMode,
      createPlan,
      activeWorkspaceId,
      refetch,
      editingEquipmentId,
    ],
  )

  return {
    state: {
      viewMode,
      displayMode,
      isAddPlanOpen,
      isAddEquipmentOpen,
      editingEquipmentId,
      isPanelOpen,
      selectedPlanId,
      selectedEquipmentId,
      activeWorkspaceId,
      inspectorMode,
    },
    data: {
      loading,
      error,
      plants,
      filteredEquipmentList,
      workspaceEquipmentList,
      visibleGridEquipmentList,
      selectedPlan,
      selectedEquipment,
      selectedWorkspace,
      breadcrumbPlant,
      alarmCount,
      warningCount,
      deployFailedCount,
      failedEquipmentIds,
      abnormalModelEquipmentIds,
    },
    setters: {
      setDisplayMode,
    },
    handlers,
  }
}
