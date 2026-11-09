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

/** Read-only feature grants, meaningful for a VIEWER. */
export const READ_GRANTS = ['MONITORING_VIEW', 'NOTIFICATIONS_VIEW'] as const;
export type ReadGrant = (typeof READ_GRANTS)[number];

/** MODEL-SERVE-034. Member-management grants, meaningful for a STAFF. */
export const STAFF_GRANTS = ['MEMBER_ROLE_ASSIGN', 'MEMBER_INVITE'] as const;
export type StaffGrant = (typeof STAFF_GRANTS)[number];

function isReadGrant(p: WorkspacePermission): p is ReadGrant {
  return (READ_GRANTS as readonly WorkspacePermission[]).includes(p);
}

function isStaffGrant(p: WorkspacePermission): p is StaffGrant {
  return (STAFF_GRANTS as readonly WorkspacePermission[]).includes(p);
}

/** OWNER and STAFF read every feature; a VIEWER reads one only when an
 *  OWNER granted it. No member row → no access.
 *
 *  Takes a READ grant only: every non-VIEWER passes here, so handing it a
 *  member-management grant would admit every STAFF. Those go through
 *  `memberManagement`. */
export function canReadWithGrant(
  member: MemberAccess | null,
  permission: ReadGrant,
): boolean {
  if (!member) return false;
  if (member.role !== 'VIEWER') return true;
  return member.permissions.includes(permission);
}

/** What to store for a member, per role: a VIEWER keeps read grants, a STAFF
 *  keeps member-management grants, an OWNER needs none. Anything else is
 *  dropped, so a role change starts the new role clean. */
export function normalizePermissions(
  role: PrismaEnums.WorkspaceRole,
  permissions: readonly WorkspacePermission[],
): WorkspacePermission[] {
  const keep =
    role === 'VIEWER' ? isReadGrant : role === 'STAFF' ? isStaffGrant : null;
  if (!keep) return [];
  return [...new Set(permissions.filter(keep))];
}

/** Who is acting on the member list. `isWorkspaceOwner` is the creator
 *  (`Workspace.ownerId`), who may have no member row. */
export type MemberActor = {
  isWorkspaceOwner: boolean;
  member: MemberAccess | null;
};

export type MemberManagement = {
  /** Owner powers: any role (OWNER included), any member, Staff grants. */
  full: boolean;
  /** Switch OTHER non-owner members between STAFF and VIEWER. */
  assignRoles: boolean;
  /** Invite as STAFF or VIEWER. */
  invite: boolean;
};

/**
 * MODEL-SERVE-034. What an actor may do to the member list. An owner (the
 * creator, or an OWNER member row) has everything; a STAFF member has only
 * what an owner granted; a VIEWER has nothing.
 */
export function memberManagement(actor: MemberActor): MemberManagement {
  const full = actor.isWorkspaceOwner || actor.member?.role === 'OWNER';
  if (full) return { full: true, assignRoles: true, invite: true };
  const staff = actor.member?.role === 'STAFF' ? actor.member : null;
  return {
    full: false,
    assignRoles: Boolean(staff?.permissions.includes('MEMBER_ROLE_ASSIGN')),
    invite: Boolean(staff?.permissions.includes('MEMBER_INVITE')),
  };
}

/**
 * Why `access` may NOT move `target` to `nextRole`; null when it may.
 * A delegate (STAFF with MEMBER_ROLE_ASSIGN) works only between STAFF and
 * VIEWER, on someone else, who is not an owner — so no grant can be turned
 * into owner power, directly or through a friend.
 */
export function roleChangeBlocker(input: {
  access: MemberManagement;
  actorUserId: string;
  target: { userId: string; role: PrismaEnums.WorkspaceRole };
  nextRole: PrismaEnums.WorkspaceRole;
}): string | null {
  const { access, actorUserId, target, nextRole } = input;
  if (access.full) return null;
  if (!access.assignRoles)
    return 'Only workspace owners, or staff an owner allowed to assign roles, can change roles';
  if (target.userId === actorUserId) return 'You cannot change your own role';
  if (target.role === 'OWNER')
    return "Only an owner can change an owner's role";
  if (nextRole === 'OWNER') return 'Only an owner can make someone an owner';
  return null;
}

/**
 * The permissions to store after a role change. An owner sets them as sent
 * (or keeps the current ones when none are sent). A delegate cannot touch
 * member-management grants: a member who stays STAFF keeps the ones an owner
 * gave; a VIEWER's read grants are the delegate's to set.
 */
export function resolvePermissionsForChange(input: {
  access: MemberManagement;
  current: readonly WorkspacePermission[];
  requested: readonly WorkspacePermission[] | undefined;
  nextRole: PrismaEnums.WorkspaceRole;
}): WorkspacePermission[] {
  const { access, current, requested, nextRole } = input;
  if (access.full) return normalizePermissions(nextRole, requested ?? current);
  if (nextRole === 'STAFF') return normalizePermissions('STAFF', current);
  return normalizePermissions(nextRole, requested ?? current);
}

/** Why `access` may NOT invite someone as `role`; null when it may. */
export function inviteBlocker(
  access: MemberManagement,
  role: PrismaEnums.WorkspaceRole,
): string | null {
  if (access.full) return null;
  if (!access.invite)
    return 'Only workspace owners, or staff an owner allowed to invite, can invite members';
  if (role === 'OWNER') return 'Only an owner can invite someone as an owner';
  return null;
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
