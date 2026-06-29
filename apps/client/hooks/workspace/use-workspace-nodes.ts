'use client'
import { useCallback, useEffect, useReducer } from 'react'
import { toast } from 'sonner'
import { getNodes, type CanvasNode } from '@/services/canvas'

type State = {
  nodes: CanvasNode[] | null
  loading: boolean
  error: string | null
}

type Action =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; nodes: CanvasNode[] }
  | { type: 'FETCH_ERROR'; message: string }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'FETCH_START':
      return { nodes: null, loading: true, error: null }
    case 'FETCH_SUCCESS':
      return { nodes: action.nodes, loading: false, error: null }
    case 'FETCH_ERROR':
      return { ...state, loading: false, error: action.message }
  }
}

const initialState: State = { nodes: null, loading: true, error: null }

export function useWorkspaceNodes(workspaceId: string) {
  const [state, dispatch] = useReducer(reducer, initialState)

  const fetchNodes = useCallback(async () => {
    if (!workspaceId) return
    dispatch({ type: 'FETCH_START' })
    try {
      const nodes = await getNodes(workspaceId)
      dispatch({ type: 'FETCH_SUCCESS', nodes })
    } catch {
      const message = 'Failed to load equipment'
      dispatch({ type: 'FETCH_ERROR', message })
      toast.error(message)
    }
  }, [workspaceId])

  useEffect(() => {
    fetchNodes()
  }, [fetchNodes])

  return { ...state, refetch: fetchNodes }
}
