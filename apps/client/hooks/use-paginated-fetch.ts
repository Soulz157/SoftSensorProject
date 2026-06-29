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
  useEffect(() => {
    fetcherRef.current = fetcher
  }, [fetcher])

  const refetch = useCallback(async () => {
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
  }, [errorMessage])

  useEffect(() => {
    if (status !== 'authenticated') return

    let ignore = false

    const loadData = async () => {
      setIsFetching(true)
      setError(null)

      try {
        const res = await fetcherRef.current()
        if (!ignore) {
          setData(res.data)
          setIsFetching(false)
        }
      } catch {
        if (!ignore) {
          setError(errorMessage)
          toast.error(errorMessage)
          setIsFetching(false)
        }
      }
    }

    void loadData()

    return () => {
      ignore = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, errorMessage, ...deps])
  // ไฮไลท์: เอา ...deps มากางใส่ Array นี้ เพื่อบังคับให้ Effect ดึงข้อมูลใหม่เวลา Page/Search เปลี่ยนแปลง

  const loading = isFetching && data === null

  return {
    data,
    loading,
    isFetching,
    error,
    refetch,
  }
}
