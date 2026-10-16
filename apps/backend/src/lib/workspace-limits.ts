import type { PrismaTypes } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';

/**
 * MODEL-SERVE-035. Per-workspace caps on models and members, set by an admin
 * (`Workspace.maxModels` / `maxMembers`; null = no limit).
 *
 * The cap is hard for everyone, admin included: a full workspace refuses a new
 * model or member whoever asks, and the admin raises the cap first. A cap may
 * be set BELOW the current count — nothing is removed, only new adds are
 * refused until the count drops under it.
 */

export type LimitKind = 'models' | 'members';

export interface LimitUsage {
  current: number;
  /** null = no limit. */
  limit: number | null;
  /** No room for one more. */
  full: boolean;
  /** Already above the cap (it was lowered under the current count). */
  over: boolean;
}

export function limitUsage(limit: number | null, current: number): LimitUsage {
  if (limit === null) return { current, limit, full: false, over: false };
  return { current, limit, full: current >= limit, over: current > limit };
}

/** Why one more `kind` cannot be added; null when it can. */
export function limitBlocker(
  kind: LimitKind,
  limit: number | null,
  current: number,
): string | null {
  if (!limitUsage(limit, current).full) return null;
  return kind === 'models'
    ? `This workspace has reached its model limit (${limit}). Ask an admin to raise it.`
    : `This workspace has reached its member limit (${limit}). An admin can raise it.`;
}

/**
 * Refuse (409) when `workspaceId` has no room for one more `kind`. Call it
 * inside the transaction that creates the row: it locks the workspace row
 * first, so two concurrent adds cannot both see the last free slot.
 */
export async function assertWorkspaceCapacity(
  tx: PrismaTypes.TransactionClient,
  workspaceId: string,
  kind: LimitKind,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id = ${workspaceId} FOR UPDATE`;

  const workspace = await tx.workspace.findUnique({
    where: { id: workspaceId },
    select: { maxModels: true, maxMembers: true },
  });
  if (!workspace) {
    throw new AppException({
      statusCode: 404,
      message: 'Workspace not found',
      type: 'ERROR',
    });
  }

  const limit = kind === 'models' ? workspace.maxModels : workspace.maxMembers;
  if (limit === null) return;

  const current =
    kind === 'models'
      ? await tx.model.count({ where: { workspaceId } })
      : await tx.workspaceMember.count({ where: { workspaceId } });

  const blocker = limitBlocker(kind, limit, current);
  if (blocker) {
    throw new AppException({
      statusCode: 409,
      message: blocker,
      type: 'ERROR',
    });
  }
}
