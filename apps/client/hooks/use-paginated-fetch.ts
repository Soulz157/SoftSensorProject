'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import type { Paginated } from '@/types'

interface PaginatedFetchOptions {
  /** Toast the error (default). Pass false when the view already shows the
   *  error inline with a retry — one failure, one message. */
  notifyOnError?: boolean
}

export function usePaginatedFetch<T>(
  fetcher: () => Promise<{ data: Paginated<T> }>,
  deps: readonly unknown[],
  errorMessage: string,
  { notifyOnError = true }: PaginatedFetchOptions = {},
) {
  const { status } = useSession()
  const [data, setData] = useState<Paginated<T> | null>(null)
  const [isFetching, setIsFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetcherRef = useRef(fetcher)
  useEffect(() => {
    fetcherRef.current = fetcher
  }, [fetcher])

  const notifyRef = useRef(notifyOnError)
  useEffect(() => {
    notifyRef.current = notifyOnError
  }, [notifyOnError])

  // Every request (dep change or refetch) takes the next id; only the latest
  // may write state. A slow older response — e.g. page 1 landing after the
  // user moved to page 2, or a retry racing a page change — is dropped.
  const requestRef = useRef(0)

  const load = useCallback(
    async (id: number) => {
      setIsFetching(true)
      setError(null)
      try {
        const res = await fetcherRef.current()
        if (requestRef.current === id) setData(res.data)
      } catch {
        if (requestRef.current === id) {
          setError(errorMessage)
          if (notifyRef.current) toast.error(errorMessage)
        }
      } finally {
        if (requestRef.current === id) setIsFetching(false)
      }
    },
    [errorMessage],
  )

  const refetch = useCallback(() => load(++requestRef.current), [load])

  useEffect(() => {
    if (status !== 'authenticated') return

    // A request counter, not a DOM ref: reading it in cleanup is intended.
    const requests = requestRef
    void load(++requests.current)

    return () => {
      // Unmount / deps changed: whatever is in flight is stale.
      requests.current++
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, load, ...deps])
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
