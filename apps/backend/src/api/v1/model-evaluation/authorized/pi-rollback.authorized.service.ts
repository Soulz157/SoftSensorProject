import { Injectable } from '@nestjs/common';
import { PrismaService } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import { piWrite } from '@/lib/python-evaluation-client';
import {
  currentState,
  deriveStatus,
  planRollback,
  restoredOutcome,
  type CurrentState,
  type RecordedBatchPoint,
  type RollbackPlanItem,
} from '@/lib/pi-write-back';
import { ModelEvaluationAccessService } from './model-evaluation-access.service';
import {
  PiWriteBackAuthorizedService,
  type BatchRow,
} from './pi-write-back.authorized.service';
import type { RollbackDto } from './dto/model-evaluation.authorized.dto';

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function refuse(statusCode: number, message: string): AppException {
  return new AppException({ statusCode, message, type: 'ERROR' });
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    err.code === 'P2002'
  );
}

/** Drift rows listed to the caller. A tag drifted on thousands of points is
 *  one problem, not thousands of lines. */
const DRIFT_LIST_CAP = 200;
const DRIFT_MESSAGE_CAP = 5;

type OriginalValue = {
  timestamp: Date;
  beforeExisted: boolean;
  beforeValue: number | null;
  afterValue: number | null;
  itemOk: boolean;
};

type Original = BatchRow & { values: OriginalValue[] };

/**
 * MODEL-SERVE-032. Undo one write-back batch: put every point back to what PI
 * held BEFORE it (Replace the old value, or Remove a point the batch created).
 * The undo is itself a recorded batch (`kind: ROLLBACK`, `rollbackOfId`) with
 * its own before/after, so history shows the undo, not a silent revert.
 *
 * THREE REFUSALS, in the order a caller can act on them:
 *  1. LIFO. A later batch on the same tag that overlaps this range, and has
 *     not itself been rolled back, is undone first. Rolling back an older
 *     batch underneath a newer one would silently erase the newer one's
 *     "before" and leave its history lying.
 *  2. DRIFT. PI no longer holds what this batch left there (someone or
 *     something wrote since). The rollback would overwrite their work, so it
 *     needs `force`. Drift never overrides (1).
 *  3. A non-numeric system state (digital / I/O timeout) is NEVER overwritten
 *     or removed, forced or not; that point fails and the batch is PARTIAL.
 *
 * The original is marked ROLLED_BACK only when EVERY point is verified back
 * by a read-back. A partial rollback leaves it as it was; running rollback
 * again retries the remainder (restored points are skipped, not re-written,
 * and are not mistaken for drift).
 */
@Injectable()
export class PiRollbackAuthorizedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ModelEvaluationAccessService,
    private readonly writer: PiWriteBackAuthorizedService,
  ) {}

  async rollbackService(
    modelId: string,
    batchId: string,
    dto: RollbackDto,
    user: Auth.UserPayload,
  ) {
    await this.access.assertWriteBack(modelId, user);

    const original = await this.load(modelId, batchId);
    this.assertEligible(original);

    const ctx = await this.writer.sourceContext(original.sourceId);
    const target = { credentials: ctx.credentials, tag: original.tag };
    const points: RecordedBatchPoint[] = original.values.map((v) => ({
      at: v.timestamp.getTime(),
      beforeExisted: v.beforeExisted,
      beforeValue: v.beforeValue,
      afterValue: v.afterValue,
    }));

    const blockedBy = await this.findBlocking(original);
    let plan = await this.plan(target, points);

    if (dto.dryRun) {
      return {
        data: this.report(original, ctx.piAccount, plan, blockedBy, dto.force),
      };
    }

    if (blockedBy) throw this.blockedError(blockedBy);
    this.assertNoDrift(plan, dto.force);

    // claim
    let rollback: BatchRow;
    try {
      rollback = await this.prisma.piWriteBatch.create({
        data: {
          modelId,
          sourceId: original.sourceId,
          kind: 'ROLLBACK',
          tag: original.tag,
          rangeFrom: original.rangeFrom,
          rangeTo: original.rangeTo,
          pointCount: points.length,
          status: 'WRITING',
          rollbackOfId: original.id,
          createdById: user.id,
          piAccount: ctx.piAccount,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw refuse(
          409,
          `Another write to ${original.tag} is in progress. Wait for it to finish.`,
        );
      }
      throw err;
    }

    // Re-plan AFTER the claim: nothing else can write this tag now, so this
    // is the state the restore actually acts on (the plan above may be stale).
    try {
      plan = await this.plan(target, points);
      this.assertNoDrift(plan, dto.force);
      await this.prisma.piWriteValue.createMany({
        data: plan.map((p) => ({
          batchId: rollback.id,
          timestamp: new Date(p.at),
          beforeExisted: p.actual.kind === 'value',
          beforeValue: p.actual.kind === 'value' ? p.actual.value : null,
          sentValue: p.action === 'REPLACE' ? p.restoreTo : null,
          itemOk: false,
        })),
      });
    } catch (err) {
      await this.writer.finish(
        rollback.id,
        'FAILED',
        `Nothing was changed: ${msg(err)}`,
      );
      throw err;
    }

    // restore
    const writerByMs = new Map<number, { ok: boolean; error: string | null }>();
    const groupErrors: string[] = [];
    for (const [action, option] of [
      ['REPLACE', 'Replace'],
      ['REMOVE', 'Remove'],
    ] as const) {
      const items = plan.filter((p) => p.action === action);
      if (items.length === 0) continue;
      try {
        const res = await piWrite({
          credentials: ctx.credentials,
          tag: original.tag,
          update_option: option,
          points: items.map((p) => ({
            timestamp: new Date(p.at).toISOString(),
            ...(action === 'REPLACE'
              ? { value: p.restoreTo ?? undefined }
              : {}),
          })),
        });
        for (const r of res.results) {
          writerByMs.set(Date.parse(r.timestamp), {
            ok: r.ok,
            error: r.error ?? null,
          });
        }
      } catch (err) {
        groupErrors.push(`${option}: ${msg(err)}`);
        for (const p of items) {
          writerByMs.set(p.at, { ok: false, error: 'The PI request failed.' });
        }
      }
    }

    // verify by reading back
    let now: CurrentState[] | null = null;
    let readBackError: string | null = null;
    try {
      now = (await this.writer.readMatched(target, points)).map(currentState);
    } catch (err) {
      readBackError = msg(err);
    }

    let okCount = 0;
    const results = plan.map((p, i) => {
      const state: CurrentState = now?.[i] ?? { kind: 'none' };
      const writer = writerByMs.get(p.at) ?? { ok: true, error: null };
      const outcome =
        now === null
          ? { ok: false, error: 'Could not read back from PI to verify.' }
          : restoredOutcome(
              points[i],
              p.action,
              writer.ok,
              writer.error,
              state,
            );
      if (outcome.ok) okCount += 1;
      return {
        at: p.at,
        afterValue: state.kind === 'value' ? state.value : null,
        ...outcome,
      };
    });
    await this.writer.recordResults(rollback.id, results);

    const status = deriveStatus(okCount, points.length);
    const error =
      groupErrors.length > 0
        ? `PI restore failed (${groupErrors.join('; ')}). Part of it may have applied; run rollback again to retry the rest.`
        : readBackError
          ? `Restored, but could not be verified: ${readBackError}`
          : status === 'SUCCEEDED'
            ? null
            : `${points.length - okCount} point(s) could not be restored. Run rollback again to retry.`;
    const finished = await this.writer.finish(rollback.id, status, error);

    // Only a fully verified undo retires the original.
    let originalRow: BatchRow = original;
    if (status === 'SUCCEEDED') {
      originalRow = await this.prisma.piWriteBatch.update({
        where: { id: original.id },
        data: { status: 'ROLLED_BACK' },
      });
    }

    const originalOk = original.values.filter((v) => v.itemOk).length;
    return {
      data: {
        dryRun: false as const,
        batch: this.writer.summary(finished, {
          ok: okCount,
          failed: points.length - okCount,
        }),
        original: this.writer.summary(originalRow, {
          ok: originalOk,
          failed: original.values.length - originalOk,
        }),
      },
    };
  }

  // ── pieces ───────────────────────────────────────────────────────────────

  private async load(modelId: string, batchId: string): Promise<Original> {
    const row = (await this.prisma.piWriteBatch.findFirst({
      where: { id: batchId, modelId },
      include: { values: { orderBy: { timestamp: 'asc' } } },
    })) as Original | null;
    if (!row) throw refuse(404, 'Write batch not found');
    return row;
  }

  private assertEligible(b: Original): void {
    if (b.kind === 'ROLLBACK') {
      throw refuse(
        422,
        'A rollback cannot itself be rolled back. Write the values again instead.',
      );
    }
    if (b.status === 'ROLLED_BACK') {
      throw refuse(409, 'This batch has already been rolled back.');
    }
    if (b.status === 'PENDING' || b.status === 'WRITING') {
      throw refuse(409, 'This batch is still being written.');
    }
    if (b.values.length === 0) {
      throw refuse(
        422,
        'Nothing to roll back: this write was refused before it changed PI, so no snapshot exists.',
      );
    }
  }

  /** The newest later batch on this tag that overlaps the range and has not
   *  been undone. A ROLLBACK batch never blocks (its effect on a point is
   *  caught by the drift check instead). */
  private async findBlocking(o: Original) {
    return (await this.prisma.piWriteBatch.findFirst({
      where: {
        sourceId: o.sourceId,
        tag: o.tag,
        id: { not: o.id },
        createdAt: { gt: o.createdAt },
        kind: { not: 'ROLLBACK' },
        status: { not: 'ROLLED_BACK' },
        rangeFrom: { lte: o.rangeTo },
        rangeTo: { gte: o.rangeFrom },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        kind: true,
        status: true,
        createdAt: true,
        rangeFrom: true,
        rangeTo: true,
      },
    })) as {
      id: string;
      kind: string;
      status: string;
      createdAt: Date;
      rangeFrom: Date;
      rangeTo: Date;
    } | null;
  }

  private async plan(
    target: { credentials: Record<string, unknown>; tag: string },
    points: RecordedBatchPoint[],
  ): Promise<RollbackPlanItem[]> {
    const events = await this.writer.readMatched(target, points);
    return planRollback(points, events.map(currentState));
  }

  private blockedError(b: { id: string; kind: string; createdAt: Date }) {
    return refuse(
      409,
      `A later ${b.kind.toLowerCase()} write on this tag (${b.id.slice(0, 8)}, ${b.createdAt.toISOString()}) overlaps this range and has not been rolled back. Roll that one back first.`,
    );
  }

  private assertNoDrift(plan: RollbackPlanItem[], force: boolean | undefined) {
    const drifted = plan.filter((p) => p.drifted);
    if (drifted.length === 0 || force) return;
    const shown = drifted
      .slice(0, DRIFT_MESSAGE_CAP)
      .map(
        (p) =>
          `${new Date(p.at).toISOString()} (expected ${p.expected ?? 'none'}, found ${describe(p.actual)})`,
      )
      .join('; ');
    throw refuse(
      409,
      `${drifted.length} point(s) in PI no longer hold what this write left there: ${shown}${drifted.length > DRIFT_MESSAGE_CAP ? '; …' : ''}. Rolling back would overwrite those changes. Retry with force to proceed.`,
    );
  }

  private report(
    o: Original,
    piAccount: string,
    plan: RollbackPlanItem[],
    blockedBy: Awaited<ReturnType<PiRollbackAuthorizedService['findBlocking']>>,
    force: boolean | undefined,
  ) {
    const count = (a: string) => plan.filter((p) => p.action === a).length;
    const drifted = plan.filter((p) => p.drifted);
    return {
      dryRun: true as const,
      original: {
        id: o.id,
        kind: o.kind,
        tag: o.tag,
        status: o.status,
        pointCount: o.values.length,
      },
      tag: o.tag,
      piAccount,
      replaceCount: count('REPLACE'),
      removeCount: count('REMOVE'),
      skipCount: count('SKIP'),
      blockedCount: count('BLOCKED'),
      driftCount: drifted.length,
      drift: drifted.slice(0, DRIFT_LIST_CAP).map((p) => ({
        timestamp: new Date(p.at).toISOString(),
        expected: p.expected,
        actual: p.actual.kind === 'value' ? p.actual.value : p.actual.kind,
      })),
      blockedBy: blockedBy
        ? {
            id: blockedBy.id,
            kind: blockedBy.kind,
            status: blockedBy.status,
            createdAt: blockedBy.createdAt.toISOString(),
            rangeFrom: blockedBy.rangeFrom.toISOString(),
            rangeTo: blockedBy.rangeTo.toISOString(),
          }
        : null,
      // Whether a real call with the SAME `force` would go ahead.
      canProceed: blockedBy === null && (drifted.length === 0 || !!force),
      // A LIFO block is never forceable; drift is.
      canForce: blockedBy === null && drifted.length > 0,
    };
  }
}

function describe(s: CurrentState): string {
  return s.kind === 'value'
    ? String(s.value)
    : s.kind === 'none'
      ? 'none'
      : 'a system state';
}
