'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAtom } from 'jotai'
import { WorkspacePlant } from '@/types'
import { getWorkspacePlants } from '@/services/workspace-plant'
import { getNodes, type CanvasNode } from '@/services/canvas'
import {
  mpNameAtom,
  mpDescriptionAtom,
  mpWorkspaceIdAtom,
  mpPlantIdAtom,
  mpEquipmentIdAtom,
} from '@/store/model-pipeline'
import { useModelPipelineNav } from '@/hooks/model/use-model-pipeline-nav'

type PlantsState = {
  loading: boolean
  data: WorkspacePlant[]
}

type EquipmentListState = {
  data: CanvasNode[]
}

const PLANTS_IDLE: PlantsState = { loading: false, data: [] }
const PLANTS_LOADING: PlantsState = { loading: true, data: [] }
const EQUIPMENT_IDLE: EquipmentListState = { data: [] }

export function useCreateModel() {
  const router = useRouter()

  const [name, setNameAtom] = useAtom(mpNameAtom)
  const [description, setDescriptionAtom] = useAtom(mpDescriptionAtom)
  const [workspaceId, setWorkspaceIdAtom] = useAtom(mpWorkspaceIdAtom)
  const [plantId, setPlantIdAtom] = useAtom(mpPlantIdAtom)
  const [equipmentId, setEquipmentIdAtom] = useAtom(mpEquipmentIdAtom)

  const [plants, setPlants] = useState<PlantsState>(PLANTS_IDLE)
  const [equipmentList, setEquipmentList] =
    useState<EquipmentListState>(EQUIPMENT_IDLE)

  const { resetPipeline } = useModelPipelineNav()

  const setName = useCallback((v: string) => setNameAtom(v), [setNameAtom])
  const setDescription = useCallback(
    (v: string) => setDescriptionAtom(v),
    [setDescriptionAtom],
  )
  const setEquipmentId = useCallback(
    (v: string) => setEquipmentIdAtom(v),
    [setEquipmentIdAtom],
  )

  const changeWorkspace = useCallback(
    (id: string) => {
      setWorkspaceIdAtom(id)
      setPlantIdAtom('')
      setEquipmentIdAtom('')
      setPlants(PLANTS_IDLE)
      setEquipmentList(EQUIPMENT_IDLE)
      resetPipeline()
    },
    [setWorkspaceIdAtom, setPlantIdAtom, setEquipmentIdAtom, resetPipeline],
  )

  const changePlant = useCallback(
    (id: string) => {
      setPlantIdAtom(id)
      setEquipmentIdAtom('')
      setEquipmentList(EQUIPMENT_IDLE)
      resetPipeline()
    },
    [setPlantIdAtom, setEquipmentIdAtom, resetPipeline],
  )

  useEffect(() => {
    if (!workspaceId) return

    let ignore = false

    void (async () => {
      if (!ignore) setPlants(PLANTS_LOADING)
      try {
        const data = await getWorkspacePlants(workspaceId)
        if (!ignore) setPlants({ loading: false, data })
      } catch {
        if (!ignore) setPlants(PLANTS_IDLE)
      }
    })()

    return () => {
      ignore = true
    }
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId) return

    let ignore = false

    void (async () => {
      try {
        const data = await getNodes(workspaceId, plantId || undefined)
        if (!ignore) setEquipmentList({ data })
      } catch {
        if (!ignore) setEquipmentList(EQUIPMENT_IDLE)
      }
    })()

    return () => {
      ignore = true
    }
  }, [workspaceId, plantId])

  const cancel = useCallback(() => router.push('/models/views'), [router])

  return {
    form: { name, description, workspaceId, plantId, equipmentId },
    setName,
    setDescription,
    changeWorkspace,
    changePlant,
    setEquipmentId,
    plants: plants.data,
    equipmentList: equipmentList.data,
    plantsLoading: plants.loading,
    cancel,
  }
}
