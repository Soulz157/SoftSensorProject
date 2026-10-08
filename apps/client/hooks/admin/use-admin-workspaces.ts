'use client'

import { usePaginatedFetch } from '@/hooks/use-paginated-fetch'
import { workspaceService } from '@/services/workspace'
import type { AdminWorkspace } from '@/types'

interface UseAdminWorkspacesOptions {
  page: number
  limit: number
  search?: string
  /** Bump to reload the current page (e.g. after a workspace is created). */
  revision?: number
  notifyOnError?: boolean
}

export function useAdminWorkspaces({
  page,
  limit,
  search,
  revision = 0,
  notifyOnError,
}: UseAdminWorkspacesOptions) {
  return usePaginatedFetch<AdminWorkspace>(
    () => workspaceService.getAdminWorkspaces({ page, limit, search }),
    [page, limit, search, revision],
    'Failed to load workspaces',
    { notifyOnError },
  )
}
