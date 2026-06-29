import { useState, useCallback, useMemo } from 'react'
import type { Workspace } from '@/types'
import {
  type NodeStatus,
  type BinaryStatus,
  toBinaryStatus,
} from '@/lib/overview-status'

export function useWorkspaceFilter(workspaces: Workspace[]) {
  const [filterQuery, setFilterQuery] = useState('')
  const [filterStatuses, setFilterStatuses] = useState<BinaryStatus[]>([])

  const handleStatusToggle = useCallback((s: BinaryStatus) => {
    setFilterStatuses(prev =>
      prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s],
    )
  }, [])

  const handleClearAllStatuses = useCallback(() => {
    setFilterStatuses([])
  }, [])

  const highlightedIds = useMemo(() => {
    if (!filterQuery && filterStatuses.length === 0) return undefined
    const q = filterQuery.toLowerCase()
    return new Set(
      workspaces
        .filter(ws => {
          const nameMatch = !q || ws.name.toLowerCase().includes(q)
          if (!nameMatch) return false
          if (filterStatuses.length === 0) return true

          return filterStatuses.includes(
            toBinaryStatus((ws.status ?? 'normal') as NodeStatus),
          )
        })
        .map(ws => ws.id),
    )
  }, [filterQuery, filterStatuses, workspaces])

  return {
    filterQuery,
    setFilterQuery,
    filterStatuses,
    handleStatusToggle,
    handleClearAllStatuses,
    highlightedIds,
  }
}
