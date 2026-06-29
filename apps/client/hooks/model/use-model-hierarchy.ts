'use client'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useReducer } from 'react'
import { workspacesAtom, workspacesLoadingAtom } from '@/store/workspace'
import { getWorkspacePlants } from '@/services/workspace-plant'
import { getNodes, type CanvasNode } from '@/services/canvas'
import type { WorkspacePlant } from '@/types'

interface HierarchyState {
  plantsByWorkspaceId: Record<string, WorkspacePlant[]>
  nodesByWorkspaceId: Record<string, CanvasNode[]>
  isFetching: boolean
  error: string | null
}

type HierarchyAction =
  | { type: 'EMPTY' }
  | { type: 'FETCH_START' }
  | {
      type: 'FETCH_SUCCESS'
      plantsByWorkspaceId: Record<string, WorkspacePlant[]>
      nodesByWorkspaceId: Record<string, CanvasNode[]>
    }
  | { type: 'FETCH_ERROR'; message: string }

function reducer(
  state: HierarchyState,
  action: HierarchyAction,
): HierarchyState {
  switch (action.type) {
    case 'EMPTY':
      return {
        plantsByWorkspaceId: {},
        nodesByWorkspaceId: {},
        isFetching: false,
        error: null,
      }
    case 'FETCH_START':
      return { ...state, isFetching: true, error: null }
    case 'FETCH_SUCCESS':
      return {
        plantsByWorkspaceId: action.plantsByWorkspaceId,
        nodesByWorkspaceId: action.nodesByWorkspaceId,
        isFetching: false,
        error: null,
      }
    case 'FETCH_ERROR':
      return { ...state, isFetching: false, error: action.message }
  }
}

const INITIAL: HierarchyState = {
  plantsByWorkspaceId: {},
  nodesByWorkspaceId: {},
  isFetching: true,
  error: null,
}

export function useModelHierarchy() {
  const workspaces = useAtomValue(workspacesAtom)
  const workspacesLoading = useAtomValue(workspacesLoadingAtom)
  const [state, dispatch] = useReducer(reducer, INITIAL)

  const fetch = useCallback(
    (signal?: AbortSignal) => {
      if (workspacesLoading) return
      if (workspaces.length === 0) {
        dispatch({ type: 'EMPTY' })
        return
      }

      dispatch({ type: 'FETCH_START' })

      Promise.all(
        workspaces.map(ws =>
          Promise.all([getWorkspacePlants(ws.id), getNodes(ws.id)]).then(
            ([plants, nodes]) => ({ wsId: ws.id, plants, nodes }),
          ),
        ),
      )
        .then(results => {
          if (signal?.aborted) return
          const plantsByWorkspaceId: Record<string, WorkspacePlant[]> = {}
          const nodesByWorkspaceId: Record<string, CanvasNode[]> = {}
          for (const { wsId, plants, nodes } of results) {
            plantsByWorkspaceId[wsId] = plants
            nodesByWorkspaceId[wsId] = nodes
          }
          dispatch({
            type: 'FETCH_SUCCESS',
            plantsByWorkspaceId,
            nodesByWorkspaceId,
          })
        })
        .catch(() => {
          if (!signal?.aborted)
            dispatch({
              type: 'FETCH_ERROR',
              message: 'Failed to load hierarchy',
            })
        })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaces, workspacesLoading],
  )

  useEffect(() => {
    const controller = new AbortController()
    fetch(controller.signal)
    return () => controller.abort()
  }, [fetch])

  const refetch = useCallback(() => fetch(), [fetch])

  return {
    plantsByWorkspaceId: state.plantsByWorkspaceId,
    nodesByWorkspaceId: state.nodesByWorkspaceId,
    loading:
      state.isFetching && Object.keys(state.plantsByWorkspaceId).length === 0,
    isFetching: state.isFetching,
    error: state.error,
    refetch,
  }
}
