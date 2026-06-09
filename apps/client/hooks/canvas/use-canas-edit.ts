import { useState, useCallback, useRef, useEffect } from 'react'
import { useAtom } from 'jotai'
import {
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
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

const generateTempId = () =>
  `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

export function useCanvasEditor(
  workspaceId: string,
  remoteNodes: CanvasRFNode[],
  remoteEdges: Edge[],
  activePlanId: string | null,
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

  const handleConfirm = useCallback(async () => {
    const snapshot = buildSnapshotRef.current
    if (!snapshot) return

    try {
      const currentNodes = nodes
      const currentEdges = edges
      const originalNodes = snapshot.nodes

      const nodesToCreate = currentNodes.filter(n => n.id.startsWith('temp-'))
      const nodesToDelete = originalNodes.filter(
        orig => !currentNodes.find(n => n.id === orig.id),
      )
      const nodesToUpdate = currentNodes.filter(n => {
        if (n.id.startsWith('temp-')) return false
        const orig = originalNodes.find(o => o.id === n.id)
        if (!orig) return false
        return (
          Math.abs(n.position.x - orig.position.x) > 0.1 ||
          Math.abs(n.position.y - orig.position.y) > 0.1
        )
      })

      await Promise.all(nodesToDelete.map(n => deleteNode(n.id)))

      await Promise.all(
        nodesToUpdate.map(n =>
          updateNode(n.id, { x: n.position.x, y: n.position.y }),
        ),
      )

      const idMap = new Map<string, string>()
      await Promise.all(
        nodesToCreate.map(async n => {
          const created = await createNode(
            workspaceId,
            (n.data.planId as string) ?? activePlanId ?? '',
            {
              name: n.data.name as string,
              type: n.data.type as NodeType,
              status: n.data.status as NodeStatus,
              x: n.position.x,
              y: n.position.y,
            },
          )
          idMap.set(n.id, created.id)
        }),
      )
      const finalEdgesPayload = currentEdges.map(e => ({
        sourceId: idMap.get(e.source) || e.source,
        targetId: idMap.get(e.target) || e.target,
        sourceHandle: e.sourceHandle ?? undefined,
        targetHandle: e.targetHandle ?? undefined,
      }))
      await replaceEdges(workspaceId, finalEdgesPayload)

      const finalLocalNodes = currentNodes.map(n =>
        idMap.has(n.id) ? { ...n, id: idMap.get(n.id)! } : n,
      )
      const finalLocalEdges = currentEdges.map(e => ({
        ...e,
        source: idMap.get(e.source) || e.source,
        target: idMap.get(e.target) || e.target,
      }))

      setNodes(finalLocalNodes)
      setEdges(finalLocalEdges)

      buildSnapshotRef.current = {
        nodes: finalLocalNodes.map(n => ({
          ...n,
          position: { ...n.position },
        })),
        edges: [...finalLocalEdges],
      }

      setHasPendingChanges(false)
    } catch (error) {
      console.error('Failed to save changes:', error)
    }
  }, [nodes, edges, workspaceId, setNodes, setEdges])

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

  const onNodesDelete = useCallback(() => {
    setHasPendingChanges(true)
  }, [])

  const handleAddNode = useCallback(
    (name: string, type: NodeType, status: NodeStatus, planId?: string) => {
      const x = 200 + (nodes.length % 5) * 40
      const y = 200 + Math.floor(nodes.length / 5) * 60

      const newNode: CanvasRFNode = {
        id: generateTempId(),
        type: 'machineNode',
        position: { x, y },
        data: {
          name,
          type,
          status,
          icon: '',
          models: [],
          planId: planId ?? activePlanId ?? '',
        },
      }
      setNodes(prev => [...prev, newNode])
      setHasPendingChanges(true)
    },
    [nodes.length, setNodes, activePlanId],
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

    setNodes(prev => prev.filter(n => !selectedNodeIds.has(n.id)))
    setEdges(remainingEdges)
    setHasPendingChanges(true)
  }, [nodes, edges, setNodes, setEdges])

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
