import { fetchClient } from '@/lib/fetcher'

export interface NodeData {
  name: string
  type: 'machine' | 'sensor' | 'controller'
  status: 'normal' | 'warning' | 'alarm' | 'offline'
  icon?: string
  x: number
  y: number
}

export interface CanvasModel {
  id: string
  name: string
  data: Record<string, unknown> | null
  nodesId: string | null
}

export interface CanvasNode {
  id: string
  workspaceId: string
  planId: string
  data: NodeData
  models: CanvasModel[]
  createdAt: string
  updatedAt: string
}

export interface CanvasEdge {
  id: string
  workspaceId: string
  sourceId: string
  targetId: string
  sourceHandle: string | null
  targetHandle: string | null
  createdAt: string
}

export interface EdgeItem {
  sourceId: string
  targetId: string
  sourceHandle?: string
  targetHandle?: string
}

export async function getNodes(
  workspaceId: string,
  planId?: string,
): Promise<CanvasNode[]> {
  const params = new URLSearchParams({ workspaceId })
  if (planId) params.set('planId', planId)
  const res: { data: CanvasNode[] } = await fetchClient(
    `/api/v1/authorized/nodes?${params.toString()}`,
    { method: 'GET' },
  )
  return res.data
}

export async function createNode(
  workspaceId: string,
  planId: string,
  data: NodeData,
): Promise<CanvasNode> {
  const res: { data: CanvasNode } = await fetchClient(
    '/api/v1/authorized/nodes',
    {
      method: 'POST',
      body: JSON.stringify({ workspaceId, planId, data }),
    },
  )
  return res.data
}

export async function updateNode(
  nodeId: string,
  data: Partial<NodeData>,
): Promise<CanvasNode> {
  const res: { data: CanvasNode } = await fetchClient(
    `/api/v1/authorized/nodes/${nodeId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ data }),
    },
  )
  return res.data
}

export async function deleteNode(nodeId: string): Promise<void> {
  await fetchClient(`/api/v1/authorized/nodes`, {
    method: 'DELETE',
    body: JSON.stringify({ nodeId }),
  })
}

export async function getEdges(workspaceId: string): Promise<CanvasEdge[]> {
  const res: { data: CanvasEdge[] } = await fetchClient(
    `/api/v1/authorized/workspace/${workspaceId}/edges`,
    { method: 'GET' },
  )
  return res.data
}

export async function replaceEdges(
  workspaceId: string,
  edges: EdgeItem[],
): Promise<CanvasEdge[]> {
  const res: { data: CanvasEdge[] } = await fetchClient(
    `/api/v1/authorized/workspace/${workspaceId}/edges`,
    {
      method: 'PUT',
      body: JSON.stringify({ edges }),
    },
  )
  return res.data
}
