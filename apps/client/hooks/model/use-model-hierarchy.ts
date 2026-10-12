'use client'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useReducer } from 'react'
import { workspacesAtom, workspacesLoadingAtom } from '@/store/workspace'
import { getWorkspacePlants } from '@/services/workspace-plant'
import { getNodes, type CanvasNode } from '@/services/canvas'
import type { WorkspacePlant } from '@/types'

interface HierarchyState {
  plantsByWorkspaceId: Record<string, WorkspacePlant[]>
  equipmentListByWorkspaceId: Record<string, CanvasNode[]>
  isFetching: boolean
  error: string | null
}

type HierarchyAction =
  | { type: 'EMPTY' }
  | { type: 'FETCH_START' }
  | {
      type: 'FETCH_SUCCESS'
      plantsByWorkspaceId: Record<string, WorkspacePlant[]>
      equipmentListByWorkspaceId: Record<string, CanvasNode[]>
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
        equipmentListByWorkspaceId: {},
        isFetching: false,
        error: null,
      }
    case 'FETCH_START':
      return { ...state, isFetching: true, error: null }
    case 'FETCH_SUCCESS':
      return {
        plantsByWorkspaceId: action.plantsByWorkspaceId,
        equipmentListByWorkspaceId: action.equipmentListByWorkspaceId,
        isFetching: false,
        error: null,
      }
    case 'FETCH_ERROR':
      return { ...state, isFetching: false, error: action.message }
  }
}

const INITIAL: HierarchyState = {
  plantsByWorkspaceId: {},
  equipmentListByWorkspaceId: {},
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
            ([plants, equipmentList]) => ({
              wsId: ws.id,
              plants,
              equipmentList,
            }),
          ),
        ),
      )
        .then(results => {
          if (signal?.aborted) return
          const plantsByWorkspaceId: Record<string, WorkspacePlant[]> = {}
          const equipmentListByWorkspaceId: Record<string, CanvasNode[]> = {}
          for (const { wsId, plants, equipmentList } of results) {
            plantsByWorkspaceId[wsId] = plants
            equipmentListByWorkspaceId[wsId] = equipmentList
          }
          dispatch({
            type: 'FETCH_SUCCESS',
            plantsByWorkspaceId,
            equipmentListByWorkspaceId,
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
    equipmentListByWorkspaceId: state.equipmentListByWorkspaceId,
    loading:
      state.isFetching && Object.keys(state.plantsByWorkspaceId).length === 0,
    isFetching: state.isFetching,
    error: state.error,
    refetch,
  }
}
