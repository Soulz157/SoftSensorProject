import type { NodeStatus } from '@/store/status-colors'
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

export interface ModelEditHistoryEntry {
  by: string
  at: string
  fields: string[]
}

export interface AIModel {
  id: string
  workspaceId: string
  name: string
  data: {
    deployStatus: 'stopped' | 'running' | 'error' | 'initializing'
    /** MODEL-SERVE-001-T19. The setting the operator owns, separate from
     *  `deployStatus` (derived from it) — a Start/Stop control must bind to
     *  THIS, never to `deployStatus`, or an enabled-but-failing model has no
     *  way to offer Stop. See apps/backend/src/lib/deploy-status.ts's
     *  `DeployState`. */
    enabled: boolean
    prodStatus: 'normal' | 'warning' | 'alert' | 'offline' | 'frozen'
    /**
     * MODEL-SERVE-001-T23. The most recent FAILED InferenceWindow's own
     * reason, already URL-redacted server-side, derived onto every LIST
     * payload by `deriveDeployStatuses`/`overlayDeployStatus` (see
     * apps/backend/src/lib/deploy-status.ts's `DeployState.lastFailure`).
     *
     * This is the REAL deploy-failure source. Distinct from `statusDetail`
     * below, which is a manually operator-typed note explaining a `frozen`
     * prodStatus — not a failure cause. Absent whenever the model's recent
     * terminal windows hold no FAILED row, and on any payload older than
     * this field.
     */
    lastFailure?: { reason: string | null; at: string } | null
    /**
     * MODEL-SERVE-001-T30. The MONITORING axis, carried onto every LIST
     * payload by `deriveDeployStatuses`/`overlayDeployStatus` alongside
     * `deployStatus` — so the Alerts page stays a pure function over the
     * models list instead of N per-model status requests.
     *
     * LIVENESS ONLY on this path, and that is not a temporary gap:
     * `deriveDeployStatuses` hardcodes `driftMonitor: false`,
     * `driftStatus: null`, `missingPct: null` and `frozenColumns: []`
     * (apps/backend/src/lib/deploy-status.ts:318-346), because drift needs a
     * per-model baseline read and frozen needs a per-window `featureStats`
     * select — the exact per-model cost the batched derivation exists to
     * avoid. Only `consecutiveFailures`, `staleness` and `hasEverSucceeded`
     * carry real signal here.
     *
     * CONSEQUENCE, and the whole reason this doc comment is long: `OFF` here
     * means "no fault, no claim" — NEVER "healthy". Do not render it as a
     * drift verdict, and do not treat its absence as a clean bill of health.
     * The detail page's own `getStatus` read is what makes a drift claim.
     *
     * Optional because any payload older than T26 simply does not carry it.
     */
    monitoring?: {
      status:
        | 'OFF'
        | 'UNKNOWN'
        | 'OK'
        | 'WARN'
        | 'CRITICAL'
        | 'ALERT'
        | 'FROZEN'
      reason:
        | 'SOURCE_UNREACHABLE'
        | 'STALE'
        | 'NO_PREDICTIONS'
        | 'BAD_DATA'
        | 'SENSOR_FROZEN'
        | 'DRIFT_CRITICAL'
        | 'DRIFT_WARN'
        | null
      frozenColumns: string[]
    } | null
    statusDetail?: string
    deployedBy?: string
    deployedAt?: string
    lastEditedBy?: string
    lastEditedAt?: string
    lastEditedFields?: string[]
    editHistory: ModelEditHistoryEntry[]
    logs: ModelLog[]
    /** Wizard data-source/tags/processing config (Model.data.config). */
    config?: import('@/lib/model-config').ModelConfig
  } | null
  nodesId: string | null
  datasetId: string | null
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
    plans?: number
    datasets?: number
  }
  /**
   * Relation counts from the workspace list payload. `null`/`undefined` means
   * the payload did not supply the count — render it as unknown, never as 0.
   */
  modelsCount?: number | null
  plantsCount?: number | null
  datasetsCount?: number | null
  nodeCount?: number
  alarmCount?: number
  /**
   * Operating state, derived server-side by `deriveNodeSummary`. REQUIRED: an
   * absent status is read as `abnormal` by `toBinaryStatus`, which would paint
   * a false alarm. Every path that puts a Workspace into `workspacesAtom` must
   * supply it — see services/workspace.ts:createWorkspace.
   */
  status: NodeStatus
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
