import type {
  ReadGrant,
  StaffGrant,
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
  value: ReadGrant
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

/**
 * MODEL-SERVE-034. Member-management grants an OWNER gives one STAFF member.
 * Mirrors `STAFF_GRANTS` in `apps/backend/src/lib/workspace-permission.ts`.
 */
export const STAFF_PERMISSION_OPTIONS: ReadonlyArray<{
  value: StaffGrant
  label: string
  description: string
}> = [
  {
    value: 'MEMBER_ROLE_ASSIGN',
    label: 'Assign roles',
    description:
      "Switch other members between Staff and Viewer, and set a viewer's feature access. Never Owner.",
  },
  {
    value: 'MEMBER_INVITE',
    label: 'Invite members',
    description: 'Invite people as Staff or Viewer.',
  },
]

const READ_GRANT_VALUES: readonly WorkspacePermission[] =
  WORKSPACE_PERMISSION_OPTIONS.map(o => o.value)
const STAFF_GRANT_VALUES: readonly WorkspacePermission[] =
  STAFF_PERMISSION_OPTIONS.map(o => o.value)

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
    description: 'Edits models, datasets and monitoring',
  },
  {
    value: 'VIEWER',
    label: 'Viewer',
    description: 'Read access, plus any grants',
  },
]

/**
 * Access that comes WITH a role rather than being granted per member, shown
 * read-only in the Manage access dialog. Mirrors the backend rule in
 * `apps/backend/src/lib/dataset-manage-access.ts`: OWNER and STAFF manage
 * every dataset in the workspace; a VIEWER manages only datasets they made.
 */
export const ROLE_ACCESS_OPTIONS: ReadonlyArray<{
  key: 'DATASET_MANAGE'
  label: string
  description: string
}> = [
  {
    key: 'DATASET_MANAGE',
    label: 'Dataset management',
    description:
      'Edit, rename and delete any dataset in this workspace. Viewers manage only datasets they created.',
  },
]

/** Whether a role carries dataset management over teammates' datasets. */
export function roleCanManageDatasets(role: WorkspaceRole): boolean {
  return role !== 'VIEWER'
}

/** OWNER and STAFF have every feature; a VIEWER only what was granted.
 *  READ grants only — a staff grant would pass for every STAFF here; use
 *  `memberManagementAccess` for those. */
export function memberCan(
  member: Pick<WorkspaceMember, 'role' | 'permissions'> | null | undefined,
  permission: ReadGrant,
): boolean {
  if (!member) return false
  if (member.role !== 'VIEWER') return true
  return (member.permissions ?? []).includes(permission)
}

/** Grants are stored per role: read grants for a VIEWER, staff grants for a
 *  STAFF, none for an OWNER. Mirrors the backend's `normalizePermissions`. */
export function toPermissionPayload(
  role: WorkspaceRole,
  permissions: readonly WorkspacePermission[],
): WorkspacePermission[] {
  const allowed =
    role === 'VIEWER'
      ? READ_GRANT_VALUES
      : role === 'STAFF'
        ? STAFF_GRANT_VALUES
        : []
  return [...new Set(permissions.filter(p => allowed.includes(p)))]
}

/** Labels of a member's active grants, in option order (for row chips). */
export function grantedPermissionLabels(
  member: Pick<WorkspaceMember, 'role' | 'permissions'>,
): string[] {
  const options =
    member.role === 'VIEWER'
      ? WORKSPACE_PERMISSION_OPTIONS
      : member.role === 'STAFF'
        ? STAFF_PERMISSION_OPTIONS
        : []
  return options
    .filter(o => (member.permissions ?? []).includes(o.value))
    .map(o => o.label)
}

/** What the signed-in member may do to the member list (MODEL-SERVE-034). */
export interface MemberManagementAccess {
  /** Owner powers: any role, any member, Remove, Staff grants. */
  full: boolean
  /** Switch OTHER non-owner members between Staff and Viewer. */
  assignRoles: boolean
  /** Invite as Staff or Viewer. */
  invite: boolean
}

export const FULL_MEMBER_ACCESS: MemberManagementAccess = {
  full: true,
  assignRoles: true,
  invite: true,
}

/** Mirrors the backend's `memberManagement`. The backend enforces it; this
 *  only decides which controls render. */
export function memberManagementAccess(
  currentMember: Pick<WorkspaceMember, 'role' | 'permissions'> | null,
  isOwner: boolean,
): MemberManagementAccess {
  if (isOwner || currentMember?.role === 'OWNER') return FULL_MEMBER_ACCESS
  const grants =
    currentMember?.role === 'STAFF' ? (currentMember.permissions ?? []) : []
  return {
    full: false,
    assignRoles: grants.includes('MEMBER_ROLE_ASSIGN'),
    invite: grants.includes('MEMBER_INVITE'),
  }
}

/** Whether the row gets a ⋯ menu: an owner manages everyone; a delegate only
 *  OTHER members who are not owners. */
export function canManageMemberRow(
  access: MemberManagementAccess,
  target: Pick<WorkspaceMember, 'role' | 'userId'>,
  currentUserId: string | undefined,
): boolean {
  if (access.full) return true
  if (!access.assignRoles) return false
  return target.role !== 'OWNER' && target.userId !== currentUserId
}

/** Roles the actor may set in Manage access. */
export function assignableRoleOptions(access: MemberManagementAccess) {
  return access.full
    ? WORKSPACE_ROLE_OPTIONS
    : WORKSPACE_ROLE_OPTIONS.filter(o => o.value !== 'OWNER')
}

/** Roles the actor may invite as. */
export function invitableRoleOptions(access: MemberManagementAccess) {
  return assignableRoleOptions(access)
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
