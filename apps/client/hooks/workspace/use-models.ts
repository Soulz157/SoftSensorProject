'use client'

import { useCallback, useEffect, useReducer } from 'react'
import { toast } from 'sonner'
import { AIModel } from '@/types'
import { getModels } from '@/services/model'

type State = {
  data: AIModel[] | null
  isFetching: boolean
}

type Action =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; payload: AIModel[] }
  | { type: 'FETCH_ERROR' }
  | { type: 'CLEAR' }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'FETCH_START':
      return { ...state, isFetching: true }
    case 'FETCH_SUCCESS':
      return { data: action.payload, isFetching: false }
    case 'FETCH_ERROR':
      return { ...state, isFetching: false }
    case 'CLEAR':
      return { data: [], isFetching: false }
    default:
      return state
  }
}

export function useModels(workspaceId: string | null) {
  const [state, dispatch] = useReducer(reducer, {
    data: null,
    isFetching: false,
  })

  const loading = state.isFetching && state.data === null

  const refetch = useCallback(async () => {
    if (!workspaceId) return dispatch({ type: 'CLEAR' })

    dispatch({ type: 'FETCH_START' })
    try {
      const models = await getModels(workspaceId)
      dispatch({ type: 'FETCH_SUCCESS', payload: models })
    } catch {
      dispatch({ type: 'FETCH_ERROR' })
      toast.error('Failed to manually reload models')
    }
  }, [workspaceId])

  useEffect(() => {
    let ignore = false

    const doFetch = async () => {
      if (!workspaceId) {
        dispatch({ type: 'CLEAR' })
        return
      }

      dispatch({ type: 'FETCH_START' })
      try {
        const models = await getModels(workspaceId)
        if (!ignore) {
          dispatch({ type: 'FETCH_SUCCESS', payload: models })
        }
      } catch {
        if (!ignore) {
          dispatch({ type: 'FETCH_ERROR' })
          toast.error('Failed to load models')
        }
      }
    }

    void doFetch()

    return () => {
      ignore = true
    }
  }, [workspaceId])

  return {
    data: state.data,
    loading,
    isFetching: state.isFetching,
    refetch,
  }
}
