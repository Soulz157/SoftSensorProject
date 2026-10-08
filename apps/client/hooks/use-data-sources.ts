'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  dataSourceService,
  type CreateDataSourceInput,
} from '@/services/data-sources'
import type { SavedDataSource } from '@/lib/mock-data-sources'

export function useDataSources() {
  const [sources, setSources] = useState<SavedDataSource[]>([])
  const [loading, setLoading] = useState(true)

  // Sets state only after the request settles, so the mount effect can
  // call it.
  const fetchSources = useCallback(
    () =>
      dataSourceService
        .list()
        .then(res => setSources(res.data ?? []))
        .finally(() => setLoading(false)),
    [],
  )

  const refetch = useCallback(async () => {
    setLoading(true)
    await fetchSources()
  }, [fetchSources])

  useEffect(() => {
    void fetchSources()
  }, [fetchSources])

  const createSource = async (
    input: CreateDataSourceInput,
  ): Promise<SavedDataSource> => {
    const res = await dataSourceService.create(input)
    await refetch()
    return res.data
  }

  const updateSource = async (
    id: string,
    body: Partial<CreateDataSourceInput>,
  ): Promise<void> => {
    await dataSourceService.update(id, body)
    await refetch()
  }

  const deleteSource = async (id: string): Promise<void> => {
    await dataSourceService.delete(id)
    await refetch()
  }

  return { sources, loading, refetch, createSource, updateSource, deleteSource }
}
