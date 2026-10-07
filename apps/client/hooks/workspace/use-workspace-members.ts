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

  // The caller's own member row (role + feature grants), or null when they
  // have none — e.g. the workspace creator without a member row.
  const currentMember =
    state.members.find(m => m.userId === currentUserId) ?? null
  const isOwner = currentMember?.role === 'OWNER'

  const fetchMembers = useCallback(async () => {
    // No workspace yet (e.g. the model page before its model loads): stay in
    // the initial loading state rather than requesting `/workspace//members`.
    if (!workspaceId) return
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

  return { ...state, isOwner, currentMember, fetchMembers }
}
