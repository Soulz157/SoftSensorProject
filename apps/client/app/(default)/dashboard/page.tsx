'use client'
import { useState, useMemo } from 'react'
import { DashboardHeader } from './components/dashboard-header'
import { WorkspaceSidebar } from './components/workspace-sidebar'
import { IsometricMap } from './components/isometric-map'
import { NodeDetailPanel } from './components/node-detail-panel'
import { MachineLegend } from './components/machine-legend'
import { useDashboardData } from '../../../hooks/use-dashboard-data'
import type { NodeStatus } from './components/machines/status-colors'

export default function DashboardPage() {
  const { workspaces, nodes, loading, error } = useDashboardData()
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    null,
  )
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<NodeStatus | null>(null)

  const alarmCount = workspaces.reduce(
    (sum, ws) => sum + (ws.alarmCount ?? 0),
    0,
  )

  const selectedNode = useMemo(
    () => nodes.find(n => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  )

  const selectedNodeWorkspaceId = selectedNode?.workspaceId ?? null

  const filteredNodes = useMemo(() => {
    let result = nodes
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(n => n.data.name.toLowerCase().includes(q))
    }
    if (statusFilter) {
      result = result.filter(n => n.data.status === statusFilter)
    }
    if (selectedWorkspaceId) {
      result = result.filter(n => n.workspaceId === selectedWorkspaceId)
    }
    return result
  }, [nodes, searchQuery, statusFilter, selectedWorkspaceId])

  if (loading) return null

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-destructive">
        {error}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <DashboardHeader
        alarmCount={alarmCount}
        searchQuery={searchQuery}
        onSearch={setSearchQuery}
      />
      <div className="flex flex-1 overflow-hidden">
        <WorkspaceSidebar
          workspaces={workspaces}
          selectedWorkspaceId={selectedWorkspaceId}
          onSelectWorkspace={id =>
            setSelectedWorkspaceId(prev => (prev === id ? null : id))
          }
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
        />
        <main className="flex-1 overflow-hidden">
          <IsometricMap
            workspaces={
              selectedWorkspaceId
                ? workspaces.filter(w => w.id === selectedWorkspaceId)
                : workspaces
            }
            nodes={filteredNodes}
            selectedWorkspaceId={selectedWorkspaceId}
            selectedNodeId={selectedNodeId}
            onNodeClick={id =>
              setSelectedNodeId(prev => (prev === id ? null : id))
            }
          />
        </main>
        <NodeDetailPanel
          node={selectedNode}
          workspaceId={selectedNodeWorkspaceId}
        />
      </div>
      <MachineLegend />
    </div>
  )
}
