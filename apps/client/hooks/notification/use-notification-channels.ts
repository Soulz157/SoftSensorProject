'use client'

import { useCallback, useEffect, useReducer } from 'react'
import { toast } from 'sonner'
import { notificationService } from '@/services/notification'
import { describeNotificationLoadError } from '@/lib/notification-load-error'
import type { NotificationChannel } from '@/types'

type State = {
  channels: NotificationChannel[]
  knownEvents: string[]
  loading: boolean
  isFetching: boolean
  /** Set when the last load FAILED — the table must say so rather than
   *  render its empty state, which reads as "this workspace has none". */
  error: string | null
}

type Action =
  | { type: 'FETCH_START' }
  | {
      type: 'FETCH_SUCCESS'
      channels: NotificationChannel[]
      knownEvents: string[]
    }
  | { type: 'FETCH_ERROR'; error: string }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'FETCH_START':
      return {
        ...state,
        loading: state.channels.length === 0,
        isFetching: true,
        error: null,
      }
    case 'FETCH_SUCCESS':
      return {
        channels: action.channels,
        knownEvents: action.knownEvents,
        loading: false,
        isFetching: false,
        error: null,
      }
    case 'FETCH_ERROR':
      return {
        ...state,
        loading: false,
        isFetching: false,
        error: action.error,
      }
  }
}

const initialState: State = {
  channels: [],
  knownEvents: [],
  loading: true,
  isFetching: false,
  error: null,
}

/** MODEL-SERVE-022-T05. Mirrors `useWorkspaceMembers`'s own shape — one
 *  reducer, refetch-after-every-mutation (no optimistic update), since a
 *  channel list is small and correctness (the server's own `hasTarget`
 *  mask, the real `knownEvents` catalogue) matters more than latency here. */
export function useNotificationChannels(workspaceId: string) {
  const [state, dispatch] = useReducer(reducer, initialState)

  const fetchChannels = useCallback(async () => {
    dispatch({ type: 'FETCH_START' })
    try {
      const res = await notificationService.listChannels(workspaceId)
      dispatch({
        type: 'FETCH_SUCCESS',
        channels: res.data.channels,
        knownEvents: res.data.knownEvents,
      })
    } catch (err: unknown) {
      dispatch({
        type: 'FETCH_ERROR',
        error: describeNotificationLoadError(err, 'notification channels'),
      })
      toast.error('Failed to load notification channels')
    }
  }, [workspaceId])

  useEffect(() => {
    fetchChannels()
  }, [fetchChannels])

  return { ...state, fetchChannels }
}
