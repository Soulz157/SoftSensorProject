import type { PrismaEnums } from '@softsensor/prisma';

/**
 * Who may EDIT / RENAME / DELETE a dataset (and open its edit draft).
 *
 * Reads stay workspace-wide; this is the write rule. A dataset is managed by:
 *   - its creator, whatever their role now is (a role only ever ADDS rights),
 *   - the workspace creator (`Workspace.ownerId`),
 *   - a workspace member with role OWNER or STAFF.
 * A VIEWER who did not create the dataset cannot.
 *
 * ADMIN is deliberately not special-cased: it manages only as creator, the
 * same convention as `assertIsOwner` in the notification-channel service.
 *
 * Kept apart from `workspace-permission.ts`, whose grants are read-only and
 * must never decide a write.
 *
 * Pure module — no DI, no IO.
 */

export type DatasetManageFacts = {
  userId: string;
  createdById: string;
  workspaceOwnerId: string;
  memberRole: PrismaEnums.WorkspaceRole | null | undefined;
};

export function canManageDataset({
  userId,
  createdById,
  workspaceOwnerId,
  memberRole,
}: DatasetManageFacts): boolean {
  if (createdById === userId) return true;
  if (workspaceOwnerId === userId) return true;
  return memberRole === 'OWNER' || memberRole === 'STAFF';
}

/**
 * Prisma select that carries exactly the facts `canManageDataset` needs.
 * Spread into a `dataset` select so every call site reads the same shape.
 */
export function datasetManageSelect(userId: string) {
  return {
    createdById: true,
    workspace: {
      select: {
        ownerId: true,
        members: {
          where: { userId },
          select: { role: true },
          take: 1,
        },
      },
    },
  } as const;
}

export type DatasetManageRow = {
  createdById: string;
  workspace: {
    ownerId: string;
    members: { role: PrismaEnums.WorkspaceRole }[];
  };
};

/** Row selected with `datasetManageSelect` → verdict for `userId`. */
export function canManageDatasetRow(
  row: DatasetManageRow,
  userId: string,
): boolean {
  return canManageDataset({
    userId,
    createdById: row.createdById,
    workspaceOwnerId: row.workspace.ownerId,
    memberRole: row.workspace.members[0]?.role,
  });
}
