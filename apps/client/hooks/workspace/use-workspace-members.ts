'use client'

import { useCallback, useEffect, useReducer } from 'react'
import { workspaceService } from '@/services/workspace'
import type { WorkspaceMember } from '@/types'

type State = {
  members: WorkspaceMember[]
  loading: boolean
  isFetching: boolean
}

type Action =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; members: WorkspaceMember[] }
  | { type: 'FETCH_ERROR' }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'FETCH_START':
      return { members: [], loading: true, isFetching: true }
    case 'FETCH_SUCCESS':
      return { members: action.members, loading: false, isFetching: false }
    case 'FETCH_ERROR':
      return { ...state, loading: false, isFetching: false }
  }
}

const initialState: State = { members: [], loading: true, isFetching: false }

export function useWorkspaceMembers(
  workspaceId: string,
  currentUserId: string | undefined,
) {
  const [state, dispatch] = useReducer(reducer, initialState)

  const isOwner = state.members.some(
    m => m.userId === currentUserId && m.role === 'OWNER',
  )

  const fetchMembers = useCallback(async () => {
    dispatch({ type: 'FETCH_START' })
    try {
      const res = await workspaceService.listMembers(workspaceId)
      dispatch({ type: 'FETCH_SUCCESS', members: res.data ?? [] })
    } catch {
      dispatch({ type: 'FETCH_ERROR' })
    }
  }, [workspaceId])

  useEffect(() => {
    fetchMembers()
  }, [fetchMembers])

  return { ...state, isOwner, fetchMembers }
}
