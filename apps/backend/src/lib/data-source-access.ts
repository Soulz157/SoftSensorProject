import type { PrismaTypes } from '@softsensor/prisma';

/**
 * Who may SEE and USE a data source: its creator, or an owner/member of the
 * (non-deleted) workspace it is shared with. "Use" means running connector
 * calls (test, tag browse, fetch) with the stored credentials — those calls
 * go through `DataSourceConnectService.resolveById`, which applies this same
 * filter. Edit/delete are NOT covered here; they stay creator-only.
 *
 * One definition for both the CRUD list and the connector, so a source the
 * list shows a teammate is always one they can actually query through, and
 * vice versa.
 */
export function dataSourceAccessWhere(
  userId: string,
): PrismaTypes.DataSourceWhereInput {
  return {
    OR: [
      { createdById: userId },
      {
        workspace: {
          deletedAt: null,
          OR: [{ ownerId: userId }, { members: { some: { userId } } }],
        },
      },
    ],
  };
}
