'use client'
import { useAtomValue } from 'jotai'
import { useEffect, useState } from 'react'
import { getNodes } from '@/services/canvas'
import { workspacesAtom } from '@/store/workspace'
import type { CanvasNode } from '@/services/canvas'
import type { Workspace } from '@/types'

interface DashboardData {
  workspaces: Workspace[]
  nodes: CanvasNode[]
  loading: boolean
  error: string | null
}

export function useDashboardData(): DashboardData {
  const workspaces = useAtomValue(workspacesAtom)
  const [nodes, setNodes] = useState<CanvasNode[]>([])
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
        setNodes(results.flat())
        setError(null)
      })
      .catch(() => {
        if (cancelled) return
        setError('Failed to load device data')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [workspaces])

  return { workspaces, nodes, loading, error }
}
