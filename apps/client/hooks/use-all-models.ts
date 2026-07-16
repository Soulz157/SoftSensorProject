'use client'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect } from 'react'
import { getModels } from '@/services/model'
import {
  workspacesAtom,
  workspacesLoadingAtom,
  modelsRefreshAtom,
  allModelsAtom,
  allModelsFetchingAtom,
  allModelsErrorAtom,
} from '@/store/workspace'
import type { AIModel, Workspace } from '@/types'

/**
 * Returns a function that invalidates every `useAllModels` consumer (sidebar
 * dot, Alerts badge, model pages). Call after any deploy-state mutation.
 */
export function useRefreshModels() {
  const setRefresh = useSetAtom(modelsRefreshAtom)
  return useCallback(() => setRefresh(c => c + 1), [setRefresh])
}

export type ModelWithWorkspace = AIModel & { workspaceName: string }

type Setters = {
  setModels: (m: ModelWithWorkspace[] | null) => void
  setFetching: (b: boolean) => void
  setError: (e: string | null) => void
}

// Module-level dedup: the 3 overview mounts of `useAllModels` all call the
// loader in the same tick; only the first triggers the per-workspace fan-out.
// The result is written to shared atoms, so every consumer observes one fetch.
// `currentKey` also acts as a cache — re-mounting with the same workspaces +
// refresh counter skips the fetch and keeps the cached models.
let currentKey: string | null = null

function loadAllModels(workspaces: Workspace[], key: string, s: Setters): void {
  if (key === currentKey) return
  currentKey = key
  s.setFetching(true)
  s.setError(null)

  Promise.all(workspaces.map(ws => getModels(ws.id)))
    .then(results => {
      if (key !== currentKey) return // superseded by a newer key
      const models: ModelWithWorkspace[] = []
      workspaces.forEach((ws, i) => {
        ;(results[i] ?? []).forEach(m =>
          models.push({ ...m, workspaceName: ws.name }),
        )
      })
      s.setModels(models)
      s.setFetching(false)
    })
    .catch(() => {
      if (key !== currentKey) return
      s.setError('Failed to load models')
      s.setFetching(false)
      currentKey = null // allow a retry on the next mount/effect
    })
}

export function useAllModels() {
  const workspaces = useAtomValue(workspacesAtom)
  const workspacesLoading = useAtomValue(workspacesLoadingAtom)
  const refresh = useAtomValue(modelsRefreshAtom)

  const data = useAtomValue(allModelsAtom)
  const isFetching = useAtomValue(allModelsFetchingAtom)
  const error = useAtomValue(allModelsErrorAtom)

  const setModels = useSetAtom(allModelsAtom)
  const setFetching = useSetAtom(allModelsFetchingAtom)
  const setError = useSetAtom(allModelsErrorAtom)
  const setRefresh = useSetAtom(modelsRefreshAtom)

  useEffect(() => {
    if (workspacesLoading) return
    const key = `${refresh}:${workspaces.map(w => w.id).join(',')}`

    if (workspaces.length === 0) {
      if (currentKey !== key) {
        currentKey = key
        setModels([])
        setFetching(false)
        setError(null)
      }
      return
    }

    loadAllModels(workspaces, key, { setModels, setFetching, setError })
  }, [workspaces, workspacesLoading, refresh, setModels, setFetching, setError])

  // refetch bumps the shared refresh counter so every consumer reloads once.
  const refetch = useCallback(() => setRefresh(c => c + 1), [setRefresh])

  return {
    models: data,
    loading: isFetching && data === null,
    isFetching,
    error,
    refetch,
  }
}
