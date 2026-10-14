import type { PrismaEnums } from '@softsensor/prisma';

/**
 * Workspace feature grants. One rule for "may this member READ feature X",
 * called from every per-service access helper so the helpers cannot drift on
 * what a grant means — the helpers themselves stay per-service (see
 * `PredictionLogAuthorizedService.assertModelAccess` for why), only the
 * member predicate is shared.
 *
 * A grant is read-only. Every mutating route keeps its editor/OWNER check;
 * nothing here may be used to decide a write.
 *
 * Pure module — no DI, no IO.
 */

export type WorkspacePermission = PrismaEnums.WorkspacePermission;

export type MemberAccess = {
  role: PrismaEnums.WorkspaceRole;
  permissions: readonly WorkspacePermission[];
};

/** OWNER and STAFF read every feature; a VIEWER reads one only when an
 *  OWNER granted it. No member row → no access. */
export function canReadWithGrant(
  member: MemberAccess | null,
  permission: WorkspacePermission,
): boolean {
  if (!member) return false;
  if (member.role !== 'VIEWER') return true;
  return member.permissions.includes(permission);
}

/** What to store for a member: grants only mean something for a VIEWER, so
 *  any other role stores none (a demotion back to VIEWER starts clean). */
export function normalizePermissions(
  role: PrismaEnums.WorkspaceRole,
  permissions: readonly WorkspacePermission[],
): WorkspacePermission[] {
  if (role !== 'VIEWER') return [];
  return [...new Set(permissions)];
}

/**
 * MODEL-SERVE-032. May this caller change what a model writes into the
 * plant historian (config, write, rollback)?
 *
 * Stricter than `canReadWithGrant` and than the editor rule most mutating
 * routes use (OWNER or STAFF): a PI write is attributed to the data source
 * creator's account and lands in production, so STAFF and VIEWER are out
 * even though they may edit the model. Global ADMIN and the workspace's own
 * owner qualify; so does a member row with the OWNER role.
 *
 * `isWorkspaceOwner` is `Workspace.ownerId === user.id`, which has no
 * WorkspaceMember row, so it is a separate input rather than a role.
 */
export function canWriteBack(input: {
  globalRole: PrismaEnums.Role;
  isWorkspaceOwner: boolean;
  member: Pick<MemberAccess, 'role'> | null;
}): boolean {
  if (input.globalRole === 'ADMIN') return true;
  if (input.isWorkspaceOwner) return true;
  return input.member?.role === 'OWNER';
}
