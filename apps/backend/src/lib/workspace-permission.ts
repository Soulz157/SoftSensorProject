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
