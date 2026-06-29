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
  mpNodeIdAtom,
} from '@/store/model-pipeline'
import { useModelPipelineNav } from '@/hooks/model/use-model-pipeline-nav'

type PlantsState = {
  loading: boolean
  data: WorkspacePlant[]
}

type NodesState = {
  data: CanvasNode[]
}

const PLANTS_IDLE: PlantsState = { loading: false, data: [] }
const PLANTS_LOADING: PlantsState = { loading: true, data: [] }
const NODES_IDLE: NodesState = { data: [] }

export function useCreateModel() {
  const router = useRouter()

  const [name, setNameAtom] = useAtom(mpNameAtom)
  const [description, setDescriptionAtom] = useAtom(mpDescriptionAtom)
  const [workspaceId, setWorkspaceIdAtom] = useAtom(mpWorkspaceIdAtom)
  const [plantId, setPlantIdAtom] = useAtom(mpPlantIdAtom)
  const [nodeId, setNodeIdAtom] = useAtom(mpNodeIdAtom)

  const [plants, setPlants] = useState<PlantsState>(PLANTS_IDLE)
  const [nodes, setNodes] = useState<NodesState>(NODES_IDLE)

  const { resetPipeline } = useModelPipelineNav()

  const setName = useCallback((v: string) => setNameAtom(v), [setNameAtom])
  const setDescription = useCallback(
    (v: string) => setDescriptionAtom(v),
    [setDescriptionAtom],
  )
  const setNodeId = useCallback(
    (v: string) => setNodeIdAtom(v),
    [setNodeIdAtom],
  )

  const changeWorkspace = useCallback(
    (id: string) => {
      setWorkspaceIdAtom(id)
      setPlantIdAtom('')
      setNodeIdAtom('')
      setPlants(PLANTS_IDLE)
      setNodes(NODES_IDLE)
      resetPipeline()
    },
    [setWorkspaceIdAtom, setPlantIdAtom, setNodeIdAtom, resetPipeline],
  )

  const changePlant = useCallback(
    (id: string) => {
      setPlantIdAtom(id)
      setNodeIdAtom('')
      setNodes(NODES_IDLE)
      resetPipeline()
    },
    [setPlantIdAtom, setNodeIdAtom, resetPipeline],
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
        if (!ignore) setNodes({ data })
      } catch {
        if (!ignore) setNodes(NODES_IDLE)
      }
    })()

    return () => {
      ignore = true
    }
  }, [workspaceId, plantId])

  const cancel = useCallback(() => router.push('/models/views'), [router])

  return {
    form: { name, description, workspaceId, plantId, nodeId },
    setName,
    setDescription,
    changeWorkspace,
    changePlant,
    setNodeId,
    plants: plants.data,
    nodes: nodes.data,
    plantsLoading: plants.loading,
    cancel,
  }
}
