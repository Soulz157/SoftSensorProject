'use client'

import { useCallback, useEffect, useState } from 'react'
import { datasetService, type CreateDatasetInput } from '@/services/dataset'
import type { SavedDataset } from '@/store/datasets'

export function useDatasets(workspaceId?: string) {
  const [datasets, setDatasets] = useState<SavedDataset[]>([])
  const [loading, setLoading] = useState(true)

  // A new workspace is loading from the first render that sees it —
  // adjusted during render, not in the effect below.
  const [prevWorkspaceId, setPrevWorkspaceId] = useState(workspaceId)
  if (prevWorkspaceId !== workspaceId) {
    setPrevWorkspaceId(workspaceId)
    setLoading(true)
  }

  // Sets state only after the await, so the mount/key effect can call it.
  const fetchDatasets = useCallback(async () => {
    try {
      const res = await datasetService.list(workspaceId)
      setDatasets(res.data ?? [])
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  const refetch = useCallback(async () => {
    setLoading(true)
    await fetchDatasets()
  }, [fetchDatasets])

  useEffect(() => {
    void fetchDatasets()
  }, [fetchDatasets])

  const createDataset = async (
    input: CreateDatasetInput,
  ): Promise<SavedDataset> => {
    const res = await datasetService.create(input)
    await refetch()
    return res.data
  }

  const deleteDataset = async (id: string): Promise<void> => {
    await datasetService.delete(id)
    await refetch()
  }

  const updateDataset = async (
    id: string,
    patch: Partial<CreateDatasetInput>,
  ): Promise<void> => {
    await datasetService.update(id, patch)
    await refetch()
  }

  return {
    datasets,
    loading,
    refetch,
    createDataset,
    deleteDataset,
    updateDataset,
  }
}
