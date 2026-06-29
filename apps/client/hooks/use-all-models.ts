'use client'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect, useReducer } from 'react'
import { getModels } from '@/services/model'
import {
  workspacesAtom,
  workspacesLoadingAtom,
  modelsRefreshAtom,
} from '@/store/workspace'

/**
 * Returns a function that invalidates every `useAllModels` consumer (sidebar
 * dot, Alerts badge, model pages). Call after any deploy-state mutation.
 */
export function useRefreshModels() {
  const setRefresh = useSetAtom(modelsRefreshAtom)
  return useCallback(() => setRefresh(c => c + 1), [setRefresh])
}
import type { AIModel } from '@/types'

export type ModelWithWorkspace = AIModel & { workspaceName: string }

type State = {
  data: ModelWithWorkspace[] | null
  isFetching: boolean
  error: string | null
}

type Action =
  | { type: 'EMPTY' }
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; models: ModelWithWorkspace[] }
  | { type: 'FETCH_ERROR'; message: string }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'EMPTY':
      return { data: [], isFetching: false, error: null }
    case 'FETCH_START':
      return { ...state, isFetching: true, error: null }
    case 'FETCH_SUCCESS':
      return { data: action.models, isFetching: false, error: null }
    case 'FETCH_ERROR':
      return { ...state, isFetching: false, error: action.message }
  }
}

export function useAllModels() {
  const workspaces = useAtomValue(workspacesAtom)
  const workspacesLoading = useAtomValue(workspacesLoadingAtom)
  const refresh = useAtomValue(modelsRefreshAtom)
  const [state, dispatch] = useReducer(reducer, {
    data: null,
    isFetching: true,
    error: null,
  })

  const fetch = useCallback(
    (signal?: AbortSignal) => {
      if (workspacesLoading) return
      if (workspaces.length === 0) {
        dispatch({ type: 'EMPTY' })
        return
      }

      dispatch({ type: 'FETCH_START' })

      Promise.all(workspaces.map(ws => getModels(ws.id)))
        .then(results => {
          if (signal?.aborted) return
          const models: ModelWithWorkspace[] = []
          workspaces.forEach((ws, i) => {
            const wsModels = results[i] ?? []
            wsModels.forEach(m => models.push({ ...m, workspaceName: ws.name }))
          })
          dispatch({ type: 'FETCH_SUCCESS', models })
        })
        .catch(() => {
          if (!signal?.aborted)
            dispatch({
              type: 'FETCH_ERROR',
              message: 'Failed to load models',
            })
        })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaces, workspacesLoading, refresh],
  )

  useEffect(() => {
    const controller = new AbortController()
    fetch(controller.signal)
    return () => controller.abort()
  }, [fetch])

  const refetch = useCallback(() => fetch(), [fetch])

  return {
    models: state.data,
    loading: state.isFetching && state.data === null,
    isFetching: state.isFetching,
    error: state.error,
    refetch,
  }
}
