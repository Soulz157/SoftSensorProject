'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { WorkspacePlant } from '@/types'
import { getWorkspacePlants } from '@/services/workspace-plant'
import { getNodes, type CanvasNode } from '@/services/canvas'
import { createModel } from '@/services/model'
import { MAX_ARTIFACT_BYTES } from '@/lib/mock-model-create'
import { useModelTagSelection } from '@/hooks/model/use-model-tag-selection'

export function useCreateModel() {
  const router = useRouter()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [plantId, setPlantId] = useState('')
  const [nodeId, setNodeId] = useState('')

  const [plants, setPlants] = useState<WorkspacePlant[]>([])
  const [nodes, setNodes] = useState<CanvasNode[]>([])
  const [plantsLoading, setPlantsLoading] = useState(false)

  const [artifact, setArtifact] = useState<File | null>(null)

  // PI server + tag-role selection (shared with the edit flow).
  const { piServerId, setPiServerId, tags, toggleTag, reset } =
    useModelTagSelection()

  const [isSubmitting, setIsSubmitting] = useState(false)

  const changeWorkspace = useCallback(
    (id: string) => {
      setWorkspaceId(id)
      setPlantId('')
      setNodeId('')
      setPlants([])
      setNodes([])
      reset() // workspace change clears the PI server + picked tags
    },
    [reset],
  )

  const changePlant = useCallback((id: string) => {
    setPlantId(id)
    setNodeId('')
    setNodes([])
  }, [])

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

  // Mock artifact selection with client-side size validation only.
  const selectArtifact = useCallback((file: File | null) => {
    if (file && file.size > MAX_ARTIFACT_BYTES) {
      toast.error('File exceeds the 200 MB limit')
      return
    }
    setArtifact(file)
  }, [])

  const submit = useCallback(async () => {
    if (!name.trim() || !workspaceId) {
      toast.error('Name and workspace are required')
      return
    }
    setIsSubmitting(true)
    try {
      await createModel({
        workspaceId,
        name: name.trim(),
        nodeId: nodeId || undefined,
      })
      toast.success('Model created')
      router.push('/models/views')
    } catch {
      toast.error('Failed to create model')
      setIsSubmitting(false)
    }
  }, [name, workspaceId, nodeId, router])

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
    artifact,
    selectArtifact,
    piServerId,
    setPiServerId,
    tags,
    toggleTag,
    isSubmitting,
    submit,
    cancel,
  }
}
