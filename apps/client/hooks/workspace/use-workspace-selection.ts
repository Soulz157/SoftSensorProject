import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import type { Workspace } from '@/types'
import { CanvasNode } from '@/services/canvas'

export function useWorkspaceSelection(
  workspaces: Workspace[],
  nodesByWorkspace: Record<string, CanvasNode[]>,
) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const handleDismiss = useCallback(() => setSelectedId(null), [])

  useEffect(() => {
    if (selectedId) panelRef.current?.focus()
  }, [selectedId])

  useEffect(() => {
    if (!selectedId) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleDismiss()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [selectedId, handleDismiss])

  const selectedWorkspace: Workspace | null = useMemo(
    () => workspaces.find(w => w.id === selectedId) ?? null,
    [workspaces, selectedId],
  )

  const selectedNodes = selectedId ? (nodesByWorkspace[selectedId] ?? []) : []

  return {
    selectedId,
    setSelectedId,
    selectedWorkspace,
    selectedNodes,
    panelRef,
    handleDismiss,
  }
}
