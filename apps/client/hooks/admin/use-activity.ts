'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { activityService } from '@/services/activity'
import type {
  ActivityLog,
  AuthAction,
  Paginated,
  UserActivityStats,
} from '@/types'

interface UseActivityLogOptions {
  page: number
  limit: number
  action?: AuthAction
  userId?: string
}

export function useActivityLog({
  page,
  limit,
  action,
  userId,
}: UseActivityLogOptions) {
  const { status } = useSession()
  const [data, setData] = useState<Paginated<ActivityLog> | null>(null)
  const [isFetching, setIsFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setIsFetching(true)
    setError(null)
    try {
      const res = await activityService.getActivityLog({
        page,
        limit,
        action,
        userId,
      })
      setData(res.data)
    } catch {
      const message = 'Failed to load activity log'
      setError(message)
      toast.error(message)
    } finally {
      setIsFetching(false)
    }
  }, [page, limit, action, userId])

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

interface UseUserStatsOptions {
  page: number
  limit: number
}

export function useUserStats({ page, limit }: UseUserStatsOptions) {
  const { status } = useSession()
  const [data, setData] = useState<Paginated<UserActivityStats> | null>(null)
  const [isFetching, setIsFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setIsFetching(true)
    setError(null)
    try {
      const res = await activityService.getUserStats({ page, limit })
      setData(res.data)
    } catch {
      const message = 'Failed to load user stats'
      setError(message)
      toast.error(message)
    } finally {
      setIsFetching(false)
    }
  }, [page, limit])

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
