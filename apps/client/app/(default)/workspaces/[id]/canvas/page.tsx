'use client'

import { use, useState, useCallback, useMemo } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ConnectionMode,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { cn } from '@/lib/utils'

import { useCanvas } from '@/hooks/canvas/use-canvas'
import { useWorkspace } from '@/hooks/workspace/use-workspace-by'
import { useCanvasEditor } from '@/hooks/canvas/use-canas-edit'
import { useWorkspacePlants } from '@/hooks/workspace/use-workspace-plants'
import type { CanvasData } from '@/hooks/canvas/use-canvas'

import { MachineNode } from '@/app/(default)/workspaces/[id]/canvas/components/machine-node'
import { AddNodeDialog } from '@/app/(default)/workspaces/[id]/canvas/components/add-node-dialog'
import { NodeDetailPanel } from '@/app/(default)/workspaces/[id]/canvas/components/node-detail-sheet'
import { LegendPanel } from '@/app/(default)/workspaces/[id]/canvas/components/legend-panel'
import { CanvasToolbar } from '@/app/(default)/workspaces/[id]/canvas/components/canvas-tool-bar'
import { useTheme } from 'next-themes'

type CanvasRFNode = CanvasData['nodes'][number]

export default function CanvasPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: workspaceId } = use(params)
  const { workspace } = useWorkspace(workspaceId)
  const {
    nodes: remoteNodes,
    edges: remoteEdges,
    loading,
    error,
  } = useCanvas(workspaceId)
  const { plants } = useWorkspacePlants(workspaceId)
  const [activePlanId, setActivePlanId] = useState<string | null>(null)

  const resolvedPlanId = activePlanId ?? plants[0]?.id ?? null

  const [showAddNode, setShowAddNode] = useState(false)
  const [selectedNode, setSelectedNode] = useState<CanvasRFNode | null>(null)
  const {
    isBuildMode,
    handleToggleMode,
    nodes,
    edges,
    hasPendingChanges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    onNodeDragStop,
    onNodesDelete,
    onEdgesDelete,
    handleAddNode,
    handleDeleteSelected,
    handleConfirm,
    handleCancel,
  } = useCanvasEditor(workspaceId, remoteNodes, remoteEdges, resolvedPlanId)

  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  const nodeTypes = useMemo(() => ({ machineNode: MachineNode }), [])
  const hasSelection =
    nodes.some(n => n.selected) || edges.some(e => e.selected)

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (!isBuildMode) setSelectedNode(node as CanvasRFNode)
    },
    [isBuildMode],
  )

  const onPaneClick = useCallback(() => setSelectedNode(null), [])

  return (
    <div className="flex w-full h-full overflow-hidden bg-background relative">
      <div className="relative flex-1 min-w-0 h-full flex flex-col">
        <CanvasToolbar
          workspaceName={workspace?.name ?? 'Loading...'}
          workspaceId={workspaceId}
          nodeCount={nodes.length}
          isBuildMode={isBuildMode}
          hasSelection={hasSelection}
          hasPendingChanges={hasPendingChanges}
          onToggleMode={handleToggleMode}
          onAddNode={() => setShowAddNode(true)}
          onDeleteSelected={handleDeleteSelected}
          onCancel={handleCancel}
          onConfirm={handleConfirm}
        />

        {isBuildMode && plants.length > 0 && (
          <div className="flex items-center gap-2 border-b border-border bg-[#0d1018] px-4 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
              Plan
            </span>
            <select
              value={resolvedPlanId ?? ''}
              onChange={e => setActivePlanId(e.target.value)}
              className="rounded border border-border bg-background px-2 py-0.5 text-[11px] text-foreground"
            >
              {plants.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div
          className={cn('w-full h-full relative', isBuildMode && 'build-mode')}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onNodesDelete={onNodesDelete}
            onEdgesDelete={onEdgesDelete}
            nodeTypes={nodeTypes}
            connectionMode={ConnectionMode.Loose}
            nodesConnectable={isBuildMode}
            nodesDraggable={isBuildMode}
            elementsSelectable={true}
            selectionOnDrag={isBuildMode}
            deleteKeyCode={isBuildMode ? ['Backspace', 'Delete'] : null}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            colorMode={isDark ? 'dark' : 'light'}
            proOptions={{ hideAttribution: false }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              color={isDark ? '#1e2235' : '#cbd5e1'}
            />
            <LegendPanel />
            <Controls />
            <MiniMap
              nodeColor={node => {
                const type = (node.data as Record<string, unknown>)
                  .type as string
                return type === 'machine'
                  ? '#6366f1'
                  : type === 'sensor'
                    ? '#f97316'
                    : '#22c55e'
              }}
              maskColor={isDark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)'}
            />
          </ReactFlow>
        </div>
      </div>

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-20 backdrop-blur-sm">
          <span className="text-muted-foreground text-sm font-medium">
            Loading canvas...
          </span>
        </div>
      )}

      {error && !loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-20 backdrop-blur-sm">
          <span className="text-red-500 font-medium text-sm">{error}</span>
        </div>
      )}

      <AddNodeDialog
        open={showAddNode}
        onClose={() => setShowAddNode(false)}
        onAdd={(name, type, status, plantId) => {
          handleAddNode(name, type, status, plantId)
          setShowAddNode(false)
        }}
        plants={plants}
        activePlantId={resolvedPlanId}
      />
      {selectedNode && (
        <NodeDetailPanel
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
        />
      )}
    </div>
  )
}
