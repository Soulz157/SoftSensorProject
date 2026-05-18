export interface User {
  id: string
  name: string
  email: string
}

export interface Workspace {
  id: string
  name: string
  icon: string
  color: string
  modelsCount: number
}

export interface CreateWorkspaceInput {
  name: string
  icon: string
  color: string
}
