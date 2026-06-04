'use client'

import { useCallback, useEffect, useReducer } from 'react'
import type { Edge as RFEdge, Node as RFNode } from '@xyflow/react'
import { getEdges, getNodes } from '@/services/canvas'
import type { CanvasEdge, CanvasModel, CanvasNode } from '@/services/canvas'

interface NodePayload extends Record<string, unknown> {
  name: string
  type: 'machine' | 'sensor' | 'controller'
  status: 'normal' | 'warning' | 'alarm' | 'offline'
  icon: string | undefined
  models: CanvasModel[]
}

type CanvasRFNode = RFNode<NodePayload>
type CanvasRFEdge = RFEdge

interface State {
  nodes: CanvasRFNode[]
  edges: CanvasRFEdge[]
  loading: boolean
  error: string | null
}

type Action =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; nodes: CanvasRFNode[]; edges: CanvasRFEdge[] }
  | { type: 'FETCH_ERROR'; message: string }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'FETCH_START':
      return { nodes: [], edges: [], loading: true, error: null }
    case 'FETCH_SUCCESS':
      return {
        nodes: action.nodes,
        edges: action.edges,
        loading: false,
        error: null,
      }
    case 'FETCH_ERROR':
      return { ...state, loading: false, error: action.message }
  }
}

const initialState: State = {
  nodes: [],
  edges: [],
  loading: true,
  error: null,
}

function toRFNode(node: CanvasNode): CanvasRFNode {
  return {
    id: node.id,
    type: 'machineNode',
    position: { x: node.data.x, y: node.data.y },
    data: {
      name: node.data.name,
      type: node.data.type,
      status: node.data.status ?? 'normal',
      icon: node.data.icon,
      models: node.models,
    },
  }
}

function toRFEdge(edge: CanvasEdge): CanvasRFEdge {
  return {
    id: edge.id,
    source: edge.sourceId,
    target: edge.targetId,
    sourceHandle: edge.sourceHandle ?? undefined,
    targetHandle: edge.targetHandle ?? undefined,
    type: 'default',
    animated: false,
    style: { stroke: '#6366f1', strokeWidth: 2, strokeDasharray: '5 3' },
  }
}

export interface CanvasData {
  nodes: CanvasRFNode[]
  edges: CanvasRFEdge[]
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useCanvas(workspaceId: string): CanvasData {
  const [state, dispatch] = useReducer(reducer, initialState)

  const fetchCanvas = useCallback(async () => {
    if (!workspaceId) return
    dispatch({ type: 'FETCH_START' })
    try {
      const [backendNodes, backendEdges] = await Promise.all([
        getNodes(workspaceId),
        getEdges(workspaceId),
      ])
      dispatch({
        type: 'FETCH_SUCCESS',
        nodes: backendNodes.map(toRFNode),
        edges: backendEdges.map(toRFEdge),
      })
    } catch {
      const message = 'Failed to load canvas'
      dispatch({ type: 'FETCH_ERROR', message })
    }
  }, [workspaceId])

  useEffect(() => {
    fetchCanvas()
  }, [fetchCanvas])

  return { ...state, refetch: fetchCanvas }
}
