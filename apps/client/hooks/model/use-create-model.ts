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

/**
 * Owns Phase-1 metadata (atom-backed so the nav hook can gate step 1) plus the
 * workspace→plant→node cascade fetch. Model creation itself happens in
 * `useModelTraining` when the user starts Phase 5 — this hook no longer submits.
 */
export function useCreateModel() {
  const router = useRouter()

  const [name, setNameAtom] = useAtom(mpNameAtom)
  const [description, setDescriptionAtom] = useAtom(mpDescriptionAtom)
  const [workspaceId, setWorkspaceIdAtom] = useAtom(mpWorkspaceIdAtom)
  const [plantId, setPlantIdAtom] = useAtom(mpPlantIdAtom)
  const [nodeId, setNodeIdAtom] = useAtom(mpNodeIdAtom)

  const [plants, setPlants] = useState<WorkspacePlant[]>([])
  const [nodes, setNodes] = useState<CanvasNode[]>([])
  const [plantsLoading, setPlantsLoading] = useState(false)

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
      setPlants([])
      setNodes([])
      resetPipeline()
    },
    [setWorkspaceIdAtom, setPlantIdAtom, setNodeIdAtom, resetPipeline],
  )

  const changePlant = useCallback(
    (id: string) => {
      setPlantIdAtom(id)
      setNodeIdAtom('')
      setNodes([])
      resetPipeline()
    },
    [setPlantIdAtom, setNodeIdAtom, resetPipeline],
  )

  useEffect(() => {
    if (!workspaceId) return
    let ignore = false
    setPlantsLoading(true)
    getWorkspacePlants(workspaceId)
      .then(data => {
        if (!ignore) setPlants(data)
      })
      .catch(() => {
        if (!ignore) setPlants([])
      })
      .finally(() => {
        if (!ignore) setPlantsLoading(false)
      })
    return () => {
      ignore = true
    }
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId) return
    let ignore = false
    getNodes(workspaceId, plantId || undefined)
      .then(data => {
        if (!ignore) setNodes(data)
      })
      .catch(() => {
        if (!ignore) setNodes([])
      })
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
    plants,
    nodes,
    plantsLoading,
    cancel,
  }
}
