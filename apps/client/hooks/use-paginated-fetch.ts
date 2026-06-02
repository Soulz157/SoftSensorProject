'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import type { Paginated } from '@/types'

export function usePaginatedFetch<T>(
  fetcher: () => Promise<{ data: Paginated<T> }>,
  deps: readonly unknown[],
  errorMessage: string,
) {
  const { status } = useSession()
  const [data, setData] = useState<Paginated<T> | null>(null)
  const [isFetching, setIsFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fetchData = useCallback(async () => {
    setIsFetching(true)
    setError(null)
    try {
      const res = await fetcherRef.current()
      setData(res.data)
    } catch {
      setError(errorMessage)
      toast.error(errorMessage)
    } finally {
      setIsFetching(false)
    }
  }, deps)

  useEffect(() => {
    if (status === 'loading') return
    queueMicrotask(() => {
      if (status !== 'authenticated') return
      fetchData()
    })
  }, [fetchData, status])

  return {
    data,
    loading: isFetching && data === null,
    isFetching,
    error,
    refetch: fetchData,
  }
}
