export interface UserProfile {
  id: string
  email: string
  firstName: string
  lastName: string
  company?: string
  role: string
  createdAt: Date
  updatedAt: Date
}

export interface RegisterPayload {
  firstName: string
  lastName: string
  company?: string
  email: string
  password: string
  // confirmPassword: string
  // role?: 'USER' | 'ADMIN'
}

export interface LoginPayload {
  email: string
  password: string
}

export interface UpdateProfilePayload {
  firstName?: string
  lastName?: string
  company?: string
}

export interface ModelLog {
  level: 'info' | 'warn' | 'error'
  message: string
  timestamp: string
}

export interface AIModel {
  id: string
  workspaceId: string
  name: string
  data: {
    deployStatus: 'stopped' | 'running' | 'error' | 'initializing'
    prodStatus: 'normal' | 'warning' | 'alert' | 'offline' | 'frozen'
    statusDetail?: string
    deployedBy?: string
    deployedAt?: string
    logs: ModelLog[]
  } | null
  nodesId: string | null
  createdAt: string
  updatedAt: string
  nodes: {
    id: string
    data: Record<string, unknown>
    planId: string
    plan: { id: string; name: string } | null
  } | null
}

export interface WorkspacePlant {
  id: string
  workspaceId: string
  name: string
  icon?: string
  color?: string
  description?: string
  nodeCount?: number
  alarmCount?: number
  status?: 'normal' | 'warning' | 'alarm' | 'offline'
  createdAt: string
  updatedAt: string
}

export interface Workspace {
  id: string
  ownerId: string
  name: string
  description?: string
  icon?: string
  color?: string
  thumbnailUrl?: string
  createdAt: string
  updatedAt: string
  _count: {
    members: number
    models: number
  }
  modelsCount: number
  nodeCount?: number
  alarmCount?: number
  status?: 'normal' | 'warning' | 'alarm' | 'offline'
}

export interface WorkspaceIconProps {
  iconId: string
  colorId: string
}

export interface CreateWorkspaceInput {
  name: string
  icon?: string
  color?: string
}

export interface UpdateWorkspacePayload {
  name?: string
  icon?: string
  color?: string
  role?: WorkspaceRole
  description?: string | null
}

export interface WorkspaceModel {
  id: string
  workspaceId: string
  name: string
  data: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

export type WorkspaceAction =
  | 'CREATED'
  | 'UPDATED'
  | 'DELETED'
  | 'MODEL_ADDED'
  | 'MODEL_REMOVED'
  | 'MODEL_UPDATED'

export interface WorkspaceLog {
  id: string
  workspaceId: string
  userId: string
  action: WorkspaceAction
  details: unknown | null
  createdAt: string
  user: {
    id: string
    firstName: string | null
    lastName: string | null
    email: string
  }
}

export interface WorkspaceDetail {
  id: string
  name: string
  icon: string
  color: string
  description: string | null
  createdAt: string
  updatedAt: string
  _count: { members: number; models: number }
}

export interface AdminWorkspaceDetail {
  id: string
  name: string
  icon: string
  color: string
  description: string | null
  createdAt: string
  updatedAt: string
  _count: { members: number; models: number }
  members: WorkspaceMember[]
}

export type AuthAction = 'LOGIN' | 'LOGOUT'

export interface ActivityLog {
  id: string
  userId: string
  action: AuthAction
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
  user: { id: string; firstName: string; lastName: string; email: string }
}

export interface UserActivityStats {
  id: string
  firstName: string
  lastName: string
  email: string
  role: string
  createdAt: string
  logins7d: number
}

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  limit: number
}

export type UserRole = 'USER' | 'ADMIN'

export interface PlanInfo {
  id: string
  name: string
  price: number | null
  maxWorkspaces: number
  durationMonths: number
}

export type SubscriptionStatus = 'ACTIVE' | 'EXPIRED' | 'CANCELED' | 'TRIALING'

export interface SubscriptionInfo {
  id: string
  status: SubscriptionStatus
  startDate: string
  endDate: string
  plan: PlanInfo
}

export interface AdminUser {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  company: string | null
  role: UserRole
  createdAt: string
  blockedAt: string | null
  deletedAt: string | null
  _count: { workspaces: number }
  subscriptions: Array<{ plan: { id: string; name: string } }>
}

export type WorkspaceRole = 'OWNER' | 'VIEWER' | 'STAFF'

export interface WorkspaceMember {
  id: string
  userId: string
  role: WorkspaceRole
  createdAt: string
  user: {
    id: string
    firstName: string | null
    lastName: string | null
    email: string
  }
}

export interface AdminWorkspace {
  id: string
  name: string
  color: string
  icon: string
  createdAt: string
  owner: {
    id: string
    firstName: string | null
    lastName: string | null
    email: string
  }
  _count: { models: number }
}
