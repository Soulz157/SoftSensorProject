'use client'
import { useCallback, useEffect, useReducer, useState } from 'react'
import { toast } from 'sonner'
import { workspaceService } from '@/services/workspace'
import type { WorkspaceLog } from '@/types'

const PAGE_LIMIT = 10

type State = {
  logs: WorkspaceLog[] | null
  total: number
  isFetching: boolean
  error: string | null
}

type Action =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; logs: WorkspaceLog[]; total: number }
  | { type: 'FETCH_ERROR'; message: string }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'FETCH_START':
      return { ...state, isFetching: true, error: null }
    case 'FETCH_SUCCESS':
      return {
        ...state,
        isFetching: false,
        logs: action.logs,
        total: action.total,
      }
    case 'FETCH_ERROR':
      return { ...state, isFetching: false, error: action.message }
  }
}

const initialState: State = {
  logs: null,
  total: 0,
  isFetching: false,
  error: null,
}

export function useWorkspaceLogs(workspaceId: string) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [page, setPage] = useState(1)

  const fetchLogs = useCallback(
    async (p: number) => {
      if (!workspaceId) return
      dispatch({ type: 'FETCH_START' })
      try {
        const res = await workspaceService.getWorkspaceLogs(workspaceId, {
          page: p,
          limit: PAGE_LIMIT,
        })
        dispatch({
          type: 'FETCH_SUCCESS',
          logs: res.data.items,
          total: res.data.total,
        })
      } catch {
        const message = 'Failed to load activity logs'
        dispatch({ type: 'FETCH_ERROR', message })
        toast.error(message)
      }
    },
    [workspaceId],
  )

  useEffect(() => {
    fetchLogs(page)
  }, [fetchLogs, page])

  return { ...state, page, setPage, refetch: () => fetchLogs(page) }
}
