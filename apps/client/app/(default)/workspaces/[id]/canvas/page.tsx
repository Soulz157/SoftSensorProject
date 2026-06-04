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
import type { CanvasData } from '@/hooks/canvas/use-canvas'

import { MachineNode } from '@/app/(default)/workspaces/[id]/canvas/components/machine-node'
import { AddNodeDialog } from '@/app/(default)/workspaces/[id]/canvas/components/add-node-dialog'
import { NodeDetailPanel } from '@/app/(default)/workspaces/[id]/canvas/components/node-detail-sheet'
import { LegendPanel } from '@/app/(default)/workspaces/[id]/canvas/components/legend-panel'
import { CanvasToolbar } from '@/app/(default)/workspaces/[id]/canvas/components/canvas-tool-bar'

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
  } = useCanvasEditor(workspaceId, remoteNodes, remoteEdges)

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
    <div className="flex w-full h-full overflow-hidden bg-[#0a0c12] relative">
      <div className="relative flex-1 min-w-0 h-full flex flex-col">
        <CanvasToolbar
          workspaceName={workspace?.name ?? 'Loading...'}
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
            style={{ background: '#0a0c12' }}
            proOptions={{ hideAttribution: false }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              color="#1e2235"
            />
            <LegendPanel />
            <Controls className="bg-gray-800 fill-white border-gray-700" />
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
              maskColor="rgba(0,0,0,0.5)"
            />
          </ReactFlow>
        </div>
      </div>

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0a0c12]/80 z-20">
          <span className="text-[#6b7280] text-sm">Loading canvas...</span>
        </div>
      )}

      {error && !loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0a0c12]/80 z-20">
          <span className="text-red-500 text-sm">{error}</span>
        </div>
      )}

      <AddNodeDialog
        open={showAddNode}
        onClose={() => setShowAddNode(false)}
        onAdd={(name, type, status) => {
          handleAddNode(name, type, status)
          setShowAddNode(false)
        }}
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
