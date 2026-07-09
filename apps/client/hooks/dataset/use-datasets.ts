'use client'

import { useCallback, useEffect, useState } from 'react'
import { datasetService, type CreateDatasetInput } from '@/services/dataset'
import type { SavedDataset } from '@/store/datasets'

export function useDatasets(workspaceId?: string) {
  const [datasets, setDatasets] = useState<SavedDataset[]>([])
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(async () => {
    setLoading(true)
    try {
      const res = await datasetService.list(workspaceId)
      setDatasets(res.data ?? [])
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void refetch()
  }, [refetch])

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

  return { datasets, loading, refetch, createDataset, deleteDataset }
}
