'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { userService } from '@/services/user'
import type { AdminUser, Paginated } from '@/types'

interface UseAdminUsersOptions {
  page: number
  limit: number
  search?: string
  role?: string
  status?: string
}

export function useAdminUsers({
  page,
  limit,
  search,
  role,
  status,
}: UseAdminUsersOptions) {
  const { status: sessionStatus } = useSession()
  const [data, setData] = useState<Paginated<AdminUser> | null>(null)
  const [isFetching, setIsFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setIsFetching(true)
    setError(null)
    try {
      const res = await userService.getAdminUsers({
        page,
        limit,
        search,
        role,
        status,
      })
      setData(res.data)
    } catch {
      const message = 'Failed to load users'
      setError(message)
      toast.error(message)
    } finally {
      setIsFetching(false)
    }
  }, [page, limit, search, role, status])

  useEffect(() => {
    if (sessionStatus === 'loading') return
    queueMicrotask(() => {
      if (sessionStatus !== 'authenticated') return
      fetchData()
    })
  }, [fetchData, sessionStatus])

  return {
    data,
    loading: isFetching && data === null,
    isFetching,
    error,
    refetch: fetchData,
  }
}
