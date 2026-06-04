import { useState, useCallback, useRef, useEffect } from 'react'
import { useAtom } from 'jotai'
import {
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Node,
  type Edge,
} from '@xyflow/react'

import {
  isBuildModeAtom,
  canvasActionsAtom,
  nodeToDeleteIdAtom,
} from '@/store/canvas'
import {
  createNode,
  deleteNode,
  updateNode,
  replaceEdges,
} from '@/services/canvas'
import type { CanvasData } from '@/hooks/canvas/use-canvas'

type CanvasRFNode = CanvasData['nodes'][number]
type NodeType = 'machine' | 'sensor' | 'controller'
type NodeStatus = 'normal' | 'warning' | 'alarm' | 'offline'

export function useCanvasEditor(
  workspaceId: string,
  remoteNodes: CanvasRFNode[],
  remoteEdges: Edge[],
) {
  const [isBuildMode, setIsBuildMode] = useAtom(isBuildModeAtom)
  const [, setCanvasActions] = useAtom(canvasActionsAtom)
  const [, setNodeToDeleteId] = useAtom(nodeToDeleteIdAtom)

  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasRFNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [hasPendingChanges, setHasPendingChanges] = useState(false)

  const seededRef = useRef(false)
  const edgesRef = useRef<Edge[]>([])
  const nodesRef = useRef<CanvasRFNode[]>([])
  const buildSnapshotRef = useRef<{
    nodes: CanvasRFNode[]
    edges: Edge[]
  } | null>(null)

  useEffect(() => {
    if (remoteNodes.length > 0 && !seededRef.current) {
      setNodes(remoteNodes)
      setEdges(remoteEdges)
      seededRef.current = true
    }
  }, [remoteNodes, remoteEdges, setNodes, setEdges])

  useEffect(() => {
    edgesRef.current = edges
  }, [edges])
  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  const handleConfirm = useCallback(() => {
    const snapshot = buildSnapshotRef.current
    if (!snapshot) return

    for (const node of nodes) {
      const orig = snapshot.nodes.find(s => s.id === node.id)
      if (
        orig &&
        (Math.abs(node.position.x - orig.position.x) > 0.1 ||
          Math.abs(node.position.y - orig.position.y) > 0.1)
      ) {
        updateNode(node.id, { x: node.position.x, y: node.position.y }).catch(
          console.error,
        )
      }
    }

    replaceEdges(
      workspaceId,
      edges.map(e => ({
        sourceId: e.source,
        targetId: e.target,
        sourceHandle: e.sourceHandle ?? undefined,
        targetHandle: e.targetHandle ?? undefined,
      })),
    ).catch(console.error)

    buildSnapshotRef.current = {
      nodes: nodes.map(n => ({ ...n, position: { ...n.position } })),
      edges: [...edges],
    }
    setHasPendingChanges(false)
  }, [nodes, edges, workspaceId])

  const handleToggleMode = useCallback(
    (targetMode: 'VIEW' | 'BUILD') => {
      if (targetMode === 'BUILD') {
        buildSnapshotRef.current = {
          nodes: nodesRef.current.map(n => ({
            ...n,
            position: { ...n.position },
          })),
          edges: [...edgesRef.current],
        }
        setHasPendingChanges(false)
        setIsBuildMode(true)
      } else {
        if (isBuildMode && hasPendingChanges) {
          handleConfirm()
        }
        setIsBuildMode(false)
      }
    },
    [isBuildMode, hasPendingChanges, handleConfirm, setIsBuildMode],
  )

  const handleCancel = useCallback(() => {
    const snapshot = buildSnapshotRef.current
    if (!snapshot) return
    setNodes(snapshot.nodes)
    setEdges(snapshot.edges)
    setHasPendingChanges(false)
  }, [setNodes, setEdges])

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges(eds =>
        addEdge(
          {
            ...connection,
            type: 'default',
            animated: false,
            style: {
              stroke: '#6366f1',
              strokeWidth: 2,
              strokeDasharray: '5 3',
            },
          },
          eds,
        ),
      )
      setHasPendingChanges(true)
    },
    [setEdges],
  )

  const onNodeDragStop = useCallback(() => setHasPendingChanges(true), [])
  const onEdgesDelete = useCallback(() => setHasPendingChanges(true), [])
  const onNodesDelete = useCallback((deleted: Node[]) => {
    for (const node of deleted) deleteNode(node.id).catch(console.error)
  }, [])

  const handleAddNode = useCallback(
    async (name: string, type: NodeType, status: NodeStatus) => {
      const x = 200 + (nodes.length % 5) * 40
      const y = 200 + Math.floor(nodes.length / 5) * 60
      const created = await createNode(workspaceId, {
        name,
        type,
        status,
        x,
        y,
      })
      const newNode: CanvasRFNode = {
        id: created.id,
        type: 'machineNode',
        position: { x, y },
        data: {
          name: created.data.name,
          type: created.data.type,
          status: created.data.status,
          icon: created.data.icon,
          models: created.models,
        },
      }
      setNodes(prev => [...prev, newNode])
    },
    [workspaceId, nodes.length, setNodes],
  )

  const handleDeleteSelected = useCallback(() => {
    const selectedNodeIds = new Set(
      nodes.filter(n => n.selected).map(n => n.id),
    )
    const selectedEdgeIds = new Set(
      edges.filter(e => e.selected).map(e => e.id),
    )
    const remainingEdges = edges.filter(
      e =>
        !selectedEdgeIds.has(e.id) &&
        !selectedNodeIds.has(e.source) &&
        !selectedNodeIds.has(e.target),
    )
    replaceEdges(
      workspaceId,
      remainingEdges.map(e => ({
        sourceId: e.source,
        targetId: e.target,
        sourceHandle: e.sourceHandle ?? undefined,
        targetHandle: e.targetHandle ?? undefined,
      })),
    ).catch(console.error)

    for (const nodeId of selectedNodeIds)
      deleteNode(nodeId).catch(console.error)

    setNodes(prev => prev.filter(n => !selectedNodeIds.has(n.id)))
    setEdges(remainingEdges)
    if (buildSnapshotRef.current) {
      buildSnapshotRef.current = {
        nodes: buildSnapshotRef.current.nodes.filter(
          n => !selectedNodeIds.has(n.id),
        ),
        edges: remainingEdges,
      }
    }
  }, [nodes, edges, workspaceId, setNodes, setEdges])

  useEffect(() => {
    setCanvasActions({
      onRequestDeleteNode: id => setNodeToDeleteId(id),
      onCancelDeleteNode: () => setNodeToDeleteId(null),
      onConfirmDeleteNode: async nodeId => {
        const remaining = edgesRef.current.filter(
          e => e.source !== nodeId && e.target !== nodeId,
        )
        setNodes(prev => prev.filter(n => n.id !== nodeId))
        setEdges(remaining)
        setNodeToDeleteId(null)
        await Promise.all([
          deleteNode(nodeId),
          replaceEdges(
            workspaceId,
            remaining.map(e => ({
              sourceId: e.source,
              targetId: e.target,
              sourceHandle: e.sourceHandle ?? undefined,
              targetHandle: e.targetHandle ?? undefined,
            })),
          ),
        ])
      },
    })
    return () => setCanvasActions(null)
  }, [workspaceId, setNodes, setEdges, setNodeToDeleteId, setCanvasActions])

  return {
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
  }
}
