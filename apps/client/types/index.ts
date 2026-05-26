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

export interface Workspace {
  id: string
  name: string
  icon?: string
  color?: string
  modelsCount: number
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
