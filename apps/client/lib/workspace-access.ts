import type {
  WorkspaceMember,
  WorkspacePermission,
  WorkspaceRole,
} from '@/types'

/**
 * Workspace feature grants, client side. Mirrors the backend rule in
 * `apps/backend/src/lib/workspace-permission.ts` — the backend is what
 * enforces it; this only decides what the UI shows.
 *
 * Pure module — no React, no IO.
 */

export const WORKSPACE_PERMISSION_OPTIONS: ReadonlyArray<{
  value: WorkspacePermission
  label: string
  description: string
}> = [
  {
    value: 'MONITORING_VIEW',
    label: 'Model monitoring',
    description:
      'View monitoring, versions, input data, logs and retrain results. Read-only.',
  },
  {
    value: 'NOTIFICATIONS_VIEW',
    label: 'Notifications',
    description: 'View notification channels and delivery history. Read-only.',
  },
]

export const WORKSPACE_ROLE_OPTIONS: ReadonlyArray<{
  value: WorkspaceRole
  label: string
  description: string
}> = [
  {
    value: 'OWNER',
    label: 'Owner',
    description: 'Full access, manages members',
  },
  {
    value: 'STAFF',
    label: 'Staff',
    description: 'Edits models and monitoring',
  },
  {
    value: 'VIEWER',
    label: 'Viewer',
    description: 'Read access, plus any grants',
  },
]

/** OWNER and STAFF have every feature; a VIEWER only what was granted. */
export function memberCan(
  member: Pick<WorkspaceMember, 'role' | 'permissions'> | null | undefined,
  permission: WorkspacePermission,
): boolean {
  if (!member) return false
  if (member.role !== 'VIEWER') return true
  return (member.permissions ?? []).includes(permission)
}

/** Grants only mean something for a VIEWER — any other role sends none. */
export function toPermissionPayload(
  role: WorkspaceRole,
  permissions: readonly WorkspacePermission[],
): WorkspacePermission[] {
  if (role !== 'VIEWER') return []
  return [...new Set(permissions)]
}

/** Labels of a member's active grants, in option order (for row chips). */
export function grantedPermissionLabels(
  member: Pick<WorkspaceMember, 'role' | 'permissions'>,
): string[] {
  if (member.role !== 'VIEWER') return []
  return WORKSPACE_PERMISSION_OPTIONS.filter(o =>
    (member.permissions ?? []).includes(o.value),
  ).map(o => o.label)
}

/**
 * True only when we KNOW the caller is a VIEWER without MONITORING_VIEW —
 * then the model page shows an "ask for access" note instead of tabs that
 * would 403. Anything uncertain (members still loading, no member row, the
 * workspace creator, a global ADMIN) is NOT denied: the backend stays the
 * authority, and an editor must never see a false lock.
 */
export function isMonitoringDenied({
  member,
  membersLoading,
  isWorkspaceCreator,
  isAdmin,
}: {
  member: Pick<WorkspaceMember, 'role' | 'permissions'> | null
  membersLoading: boolean
  isWorkspaceCreator: boolean
  isAdmin: boolean
}): boolean {
  if (membersLoading || isWorkspaceCreator || isAdmin || !member) return false
  return !memberCan(member, 'MONITORING_VIEW')
}
