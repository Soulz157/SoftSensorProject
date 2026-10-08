'use client'

import { usePaginatedFetch } from '@/hooks/use-paginated-fetch'
import { activityService } from '@/services/activity'
import type { ActivityLog, AuthAction, UserActivityStats } from '@/types'

interface UseActivityLogOptions {
  page: number
  limit: number
  action?: AuthAction
  userId?: string
  notifyOnError?: boolean
}

export function useActivityLog({
  page,
  limit,
  action,
  userId,
  notifyOnError,
}: UseActivityLogOptions) {
  return usePaginatedFetch<ActivityLog>(
    () => activityService.getActivityLog({ page, limit, action, userId }),
    [page, limit, action, userId],
    'Failed to load activity log',
    { notifyOnError },
  )
}

interface UseUserStatsOptions {
  page: number
  limit: number
}

export function useUserStats({ page, limit }: UseUserStatsOptions) {
  return usePaginatedFetch<UserActivityStats>(
    () => activityService.getUserStats({ page, limit }),
    [page, limit],
    'Failed to load user stats',
  )
}
