'use client'
import { useCallback, useEffect, useReducer } from 'react'
import { toast } from 'sonner'
import { getNodes, type CanvasNode } from '@/services/canvas'

type State = {
  equipmentList: CanvasNode[] | null
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
      return { equipmentList: null, loading: true, error: null }
    case 'FETCH_SUCCESS':
      return { equipmentList: action.nodes, loading: false, error: null }
    case 'FETCH_ERROR':
      return { ...state, loading: false, error: action.message }
  }
}

const initialState: State = { equipmentList: null, loading: true, error: null }

export function useWorkspaceEquipment(workspaceId: string) {
  const [state, dispatch] = useReducer(reducer, initialState)

  const fetchEquipmentList = useCallback(async () => {
    if (!workspaceId) return
    dispatch({ type: 'FETCH_START' })
    try {
      const equipmentList = await getNodes(workspaceId)
      dispatch({ type: 'FETCH_SUCCESS', nodes: equipmentList })
    } catch {
      const message = 'Failed to load equipment'
      dispatch({ type: 'FETCH_ERROR', message })
      toast.error(message)
    }
  }, [workspaceId])

  useEffect(() => {
    fetchEquipmentList()
  }, [fetchEquipmentList])

  return { ...state, refetch: fetchEquipmentList }
}
