'use client'
import { useCallback, useEffect, useReducer } from 'react'
import { toast } from 'sonner'
import { workspaceService } from '@/services/workspace'
import type { WorkspaceDetail } from '@/types'

type State = {
  workspace: WorkspaceDetail | null
  loading: boolean
  error: string | null
}

type Action =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; workspace: WorkspaceDetail }
  | { type: 'FETCH_ERROR'; message: string }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'FETCH_START':
      return { workspace: null, loading: true, error: null }
    case 'FETCH_SUCCESS':
      return { workspace: action.workspace, loading: false, error: null }
    case 'FETCH_ERROR':
      return { ...state, loading: false, error: action.message }
  }
}

const initialState: State = { workspace: null, loading: true, error: null }

export function useWorkspace(id: string) {
  const [state, dispatch] = useReducer(reducer, initialState)

  const fetchWorkspace = useCallback(async () => {
    if (!id) return
    dispatch({ type: 'FETCH_START' })
    try {
      const res = await workspaceService.getWorkspaceById(id)
      dispatch({ type: 'FETCH_SUCCESS', workspace: res.data })
    } catch {
      const message = 'Failed to load workspace'
      dispatch({ type: 'FETCH_ERROR', message })
      toast.error(message)
    }
  }, [id])

  useEffect(() => {
    fetchWorkspace()
  }, [fetchWorkspace])

  return { ...state, refetch: fetchWorkspace }
}
