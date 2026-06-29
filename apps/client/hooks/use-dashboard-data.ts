'use client'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useReducer, useState } from 'react'
import { getNodes } from '@/services/canvas'
import { workspacesAtom, workspacesLoadingAtom } from '@/store/workspace'
import type { CanvasNode } from '@/services/canvas'
import type { Workspace } from '@/types'

interface DashboardData {
  workspaces: Workspace[]
  nodes: CanvasNode[]
  loading: boolean
  error: string | null
  refetch: () => void
}

type State = {
  nodes: CanvasNode[]
  loading: boolean
  error: string | null
}

type Action =
  | { type: 'EMPTY' }
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; nodes: CanvasNode[] }
  | { type: 'FETCH_ERROR'; message: string }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'EMPTY':
      return { nodes: [], loading: false, error: null }
    case 'FETCH_START':
      return { ...state, loading: true, error: null }
    case 'FETCH_SUCCESS':
      return { nodes: action.nodes, loading: false, error: null }
    case 'FETCH_ERROR':
      return { ...state, loading: false, error: action.message }
  }
}

export function useDashboardData(): DashboardData {
  const workspaces = useAtomValue(workspacesAtom)
  const workspacesLoading = useAtomValue(workspacesLoadingAtom)
  const [fetchKey, setFetchKey] = useState(0)
  const [state, dispatch] = useReducer(reducer, {
    nodes: [],
    loading: true,
    error: null,
  })

  useEffect(() => {
    if (workspacesLoading) return
    if (workspaces.length === 0) {
      dispatch({ type: 'EMPTY' })
      return
    }

    let cancelled = false
    dispatch({ type: 'FETCH_START' })

    Promise.all(workspaces.map(ws => getNodes(ws.id)))
      .then(results => {
        if (cancelled) return
        dispatch({ type: 'FETCH_SUCCESS', nodes: results.flat() })
      })
      .catch(() => {
        if (!cancelled)
          dispatch({
            type: 'FETCH_ERROR',
            message: 'Failed to load device data',
          })
      })

    return () => {
      cancelled = true
    }
  }, [workspaces, workspacesLoading, fetchKey])

  const refetch = useCallback(() => setFetchKey(k => k + 1), [])

  return { workspaces, ...state, refetch }
}
