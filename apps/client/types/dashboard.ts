export interface Node {
  id: string
  name: string
  type: 'reactor' | 'machine' | 'sensor'
  status: 'normal' | 'warning' | 'alarm' | 'offline'
  models: {
    id: string
    name: string
    status: 'running' | 'warning' | 'error' | 'stopped'
    accuracy?: string
  }[]
}

export interface Workspace {
  id: string
  name: string
  description: string
  nodes: Node[]
  updatedAt: string
  modelsCount?: number
  color?: string
  icon?: string
}

export interface Alert {
  type: 'node' | 'model'
  workspace: string
  workspaceId: string
  name: string
  status: string
  nodeType?: string
  nodeName?: string
}
