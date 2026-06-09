'use client'
import { useAtomValue } from 'jotai'
import { useEffect, useState } from 'react'
import { getNodes } from '@/services/canvas'
import { workspacesAtom } from '@/store/workspace'
import type { CanvasNode } from '@/services/canvas'
import type { Workspace } from '@/types'

interface PlantsData {
  workspaces: Workspace[]
  nodesByWorkspace: Record<string, CanvasNode[]>
  loading: boolean
  error: string | null
}

export function usePlantsData(): PlantsData {
  const workspaces = useAtomValue(workspacesAtom)
  const [nodesByWorkspace, setNodesByWorkspace] = useState<
    Record<string, CanvasNode[]>
  >({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (workspaces.length === 0) {
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    Promise.all(workspaces.map(ws => getNodes(ws.id)))
      .then(results => {
        if (cancelled) return
        const map: Record<string, CanvasNode[]> = {}
        workspaces.forEach((ws, i) => {
          map[ws.id] = results[i] ?? []
        })
        setNodesByWorkspace(map)
        setError(null)
      })
      .catch(() => {
        if (cancelled) return
        setError('Failed to load equipment data')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [workspaces])

  return { workspaces, nodesByWorkspace, loading, error }
}
