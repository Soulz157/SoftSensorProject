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

/**
 * MODEL-SERVE-040. Where a cap comes from: an admin set it on the workspace,
 * the owner's subscription plan carries it, or nothing does (no limit).
 */
export type LimitSource = 'admin' | 'plan' | 'none';

export interface ResolvedLimit {
  /** null = no limit. */
  limit: number | null;
  source: LimitSource;
}

export interface ResolvedLimits {
  models: ResolvedLimit;
  members: ResolvedLimit;
}

/** The two per-workspace quota columns a Plan carries (null = no limit). */
export interface PlanQuota {
  maxModelsPerWorkspace: number | null;
  maxMembersPerWorkspace: number | null;
}

/** An admin cap wins; else the plan's; else no limit. */
export function pickLimit(
  adminCap: number | null,
  planCap: number | null | undefined,
): ResolvedLimit {
  if (adminCap !== null) return { limit: adminCap, source: 'admin' };
  if (planCap != null) return { limit: planCap, source: 'plan' };
  return { limit: null, source: 'none' };
}

/** Why one more `kind` cannot be added; null when it can. */
export function limitBlocker(
  kind: LimitKind,
  limit: number | null,
  current: number,
  source: LimitSource = 'admin',
): string | null {
  if (!limitUsage(limit, current).full) return null;
  if (source === 'plan') {
    return `This workspace has reached its ${kind === 'models' ? 'model' : 'member'} limit (${limit}) under the owner's subscription. The owner can upgrade, or an admin can raise it.`;
  }
  return kind === 'models'
    ? `This workspace has reached its model limit (${limit}). Ask an admin to raise it.`
    : `This workspace has reached its member limit (${limit}). An admin can raise it.`;
}

const PLAN_QUOTA_SELECT = {
  maxModelsPerWorkspace: true,
  maxMembersPerWorkspace: true,
} as const;

export interface LoadedWorkspaceLimits {
  /** The admin override columns, as stored. */
  adminModels: number | null;
  adminMembers: number | null;
  /** The owner's plan quota; null when the owner has no plan to read. */
  plan: PlanQuota | null;
  resolved: ResolvedLimits;
}

/**
 * The effective caps for one workspace: `Workspace.maxX` (admin) else the
 * workspace OWNER's current plan quota. The owner's plan is their newest
 * ACTIVE / TRIALING subscription; with none (expired, canceled, never
 * subscribed) the FREE plan applies. null when the workspace does not exist.
 *
 * `owner` is always present on a real query; a caller whose stub omits it
 * simply reads "no plan".
 */
export async function loadWorkspaceLimits(
  db: PrismaTypes.TransactionClient,
  workspaceId: string,
): Promise<LoadedWorkspaceLimits | null> {
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      maxModels: true,
      maxMembers: true,
      owner: {
        select: {
          subscriptions: {
            where: { status: { in: ['ACTIVE', 'TRIALING'] } },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { plan: { select: PLAN_QUOTA_SELECT } },
          },
        },
      },
    },
  });
  if (!workspace) return null;

  let plan: PlanQuota | null = workspace.owner?.subscriptions[0]?.plan ?? null;
  if (!plan && workspace.owner) {
    plan = await db.plan.findUnique({
      where: { name: 'FREE' },
      select: PLAN_QUOTA_SELECT,
    });
  }

  return {
    adminModels: workspace.maxModels,
    adminMembers: workspace.maxMembers,
    plan,
    resolved: {
      models: pickLimit(workspace.maxModels, plan?.maxModelsPerWorkspace),
      members: pickLimit(workspace.maxMembers, plan?.maxMembersPerWorkspace),
    },
  };
}

export interface QuotaItem extends LimitUsage {
  source: LimitSource;
}

/** The read-side shape: usage against the effective cap, with its source. */
export function buildQuota(
  resolved: ResolvedLimits,
  counts: { models: number; members: number },
): { models: QuotaItem; members: QuotaItem } {
  return {
    models: {
      ...limitUsage(resolved.models.limit, counts.models),
      source: resolved.models.source,
    },
    members: {
      ...limitUsage(resolved.members.limit, counts.members),
      source: resolved.members.source,
    },
  };
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

  const loaded = await loadWorkspaceLimits(tx, workspaceId);
  if (!loaded) {
    throw new AppException({
      statusCode: 404,
      message: 'Workspace not found',
      type: 'ERROR',
    });
  }

  const { limit, source } = loaded.resolved[kind];
  if (limit === null) return;

  const current =
    kind === 'models'
      ? await tx.model.count({ where: { workspaceId } })
      : await tx.workspaceMember.count({ where: { workspaceId } });

  const blocker = limitBlocker(kind, limit, current, source);
  if (blocker) {
    throw new AppException({
      statusCode: 409,
      message: blocker,
      type: 'ERROR',
    });
  }
}

/**
 * MODEL-SERVE-041. How many workspaces a user may OWN, from their own plan's
 * `maxWorkspaces`. A user's plan is their newest ACTIVE / TRIALING
 * subscription, else FREE (same rule as the workspace owner's plan above).
 * Admins are exempt: they create workspaces in the admin portal under their
 * own id, and a plan quota is not what governs them.
 */
export function workspaceSlotBlocker(
  limit: number | null,
  current: number,
): string | null {
  if (!limitUsage(limit, current).full) return null;
  return `You have reached your workspace limit (${limit}) on your current plan. Upgrade your plan to create more.`;
}

/** The caller's workspace-count limit; null = no limit (admin, or no plan row). */
async function loadWorkspaceSlotLimit(
  db: PrismaTypes.TransactionClient,
  user: { id: string; role: string },
): Promise<{ limit: number | null; source: LimitSource }> {
  if (user.role === 'ADMIN') return { limit: null, source: 'none' };

  const subscription = await db.subscription.findFirst({
    where: { userId: user.id, status: { in: ['ACTIVE', 'TRIALING'] } },
    orderBy: { createdAt: 'desc' },
    select: { plan: { select: { maxWorkspaces: true } } },
  });
  const plan =
    subscription?.plan ??
    (await db.plan.findUnique({
      where: { name: 'FREE' },
      select: { maxWorkspaces: true },
    }));
  if (!plan) return { limit: null, source: 'none' };
  return { limit: plan.maxWorkspaces, source: 'plan' };
}

function countOwnedWorkspaces(
  db: PrismaTypes.TransactionClient,
  userId: string,
): Promise<number> {
  return db.workspace.count({ where: { ownerId: userId, deletedAt: null } });
}

/**
 * Refuse (409) when `user` already owns as many workspaces as their plan
 * allows. Call it inside the transaction that creates the workspace: it
 * locks the user row first, so two concurrent creates cannot both take the
 * last slot.
 */
export async function assertWorkspaceSlot(
  tx: PrismaTypes.TransactionClient,
  user: { id: string; role: string },
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;

  const { limit } = await loadWorkspaceSlotLimit(tx, user);
  if (limit === null) return;

  const blocker = workspaceSlotBlocker(
    limit,
    await countOwnedWorkspaces(tx, user.id),
  );
  if (blocker) {
    throw new AppException({
      statusCode: 409,
      message: blocker,
      type: 'ERROR',
    });
  }
}

/** The caller's workspace count against their plan, for the create dialog. */
export async function buildWorkspaceSlotQuota(
  db: PrismaTypes.TransactionClient,
  user: { id: string; role: string },
): Promise<QuotaItem> {
  const { limit, source } = await loadWorkspaceSlotLimit(db, user);
  return {
    ...limitUsage(limit, await countOwnedWorkspaces(db, user.id)),
    source,
  };
}
