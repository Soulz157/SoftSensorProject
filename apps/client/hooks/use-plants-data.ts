'use client'
import { useAtomValue } from 'jotai'
import { useEffect, useReducer } from 'react'
import { getNodes } from '@/services/canvas'
import { workspacesAtom, workspacesLoadingAtom } from '@/store/workspace'
import type { CanvasNode } from '@/services/canvas'
import type { Workspace } from '@/types'

interface PlantsData {
  workspaces: Workspace[]
  nodesByWorkspace: Record<string, CanvasNode[]>
  loading: boolean
  error: string | null
}

type State = {
  nodesByWorkspace: Record<string, CanvasNode[]>
  loading: boolean
  error: string | null
}

type Action =
  | { type: 'EMPTY' }
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; map: Record<string, CanvasNode[]> }
  | { type: 'FETCH_ERROR'; message: string }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'EMPTY':
      return { nodesByWorkspace: {}, loading: false, error: null }
    case 'FETCH_START':
      return { ...state, loading: true, error: null }
    case 'FETCH_SUCCESS':
      return { nodesByWorkspace: action.map, loading: false, error: null }
    case 'FETCH_ERROR':
      return { ...state, loading: false, error: action.message }
  }
}

export function usePlantsData(): PlantsData {
  const workspaces = useAtomValue(workspacesAtom)
  const workspacesLoading = useAtomValue(workspacesLoadingAtom)
  const [state, dispatch] = useReducer(reducer, {
    nodesByWorkspace: {},
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
        const map: Record<string, CanvasNode[]> = {}
        workspaces.forEach((ws, i) => {
          map[ws.id] = results[i] ?? []
        })
        dispatch({ type: 'FETCH_SUCCESS', map })
      })
      .catch(() => {
        if (!cancelled)
          dispatch({
            type: 'FETCH_ERROR',
            message: 'Failed to load equipment data',
          })
      })

    return () => {
      cancelled = true
    }
  }, [workspaces, workspacesLoading])

  return { workspaces, ...state }
}
