import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import { decryptSecret } from '@/lib/crypto';
import { buildPiCredentials } from '@/lib/source-block';
import { piRecorded, piWrite } from '@/lib/python-evaluation-client';
import { validateOutputTags } from '@/lib/write-back-config';
import {
  deriveStatus,
  itemOutcome,
  matchNearest,
  MATCH_TOLERANCE_MS,
  normalizePoints,
  type NormalizedPoint,
  type RecordedEvent,
} from '@/lib/pi-write-back';
import { InferenceWindowSchedulerService } from '@/api/v1/inference-window/authorized/inference-window-scheduler.service';
import { ModelEvaluationAccessService } from './model-evaluation-access.service';
import { WriteBackConfigAuthorizedService } from './write-back-config.authorized.service';
import type {
  WriteBackDto,
  WriteBackHistoryQueryDto,
} from './dto/model-evaluation.authorized.dto';

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function refuse(statusCode: number, message: string): AppException {
  return new AppException({ statusCode, message, type: 'ERROR' });
}

/** Prisma's unique-constraint code, without importing its error class. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    err.code === 'P2002'
  );
}

/** Update rows per transaction when recording per-point results. */
const RESULT_CHUNK = 250;

/** PI events fetched when snapshotting. A range this dense on the tag cannot
 *  be snapshotted exactly, so the write is refused rather than approximated. */
const SNAPSHOT_MAX_EVENTS = 100_000;

export type BatchRow = {
  id: string;
  modelId: string;
  sourceId: string;
  kind: 'PREDICTION' | 'LAB' | 'ROLLBACK';
  tag: string;
  rangeFrom: Date;
  rangeTo: Date;
  pointCount: number;
  status: string;
  modelVersionId: string | null;
  rollbackOfId: string | null;
  createdById: string | null;
  piAccount: string;
  error: string | null;
  createdAt: Date;
  finishedAt: Date | null;
};

/**
 * MODEL-SERVE-032. Writes a model's predictions or lab values into PI, keeping
 * a before/after record of every point so the batch can be rolled back.
 *
 * ORDER IS THE SAFETY PROPERTY. For a real write:
 *   1. claim the tag  (a partial unique index allows ONE open batch per
 *      source+tag; the loser gets 409),
 *   2. snapshot what PI holds at each timestamp NOW (after the claim, so no
 *      other batch can change it between snapshot and write),
 *   3. persist the snapshot,
 *   4. only then write,
 *   5. read the range back and record what PI actually stored.
 * A crash after step 3 still leaves a restorable record; the boot sweep marks
 * such a batch FAILED and rollback stays available.
 *
 * Synchronous: at most 2000 points (python writes 500 per PI call), which is
 * seconds, so it does not need a background job.
 *
 * SINGLE REPLICA: `onModuleInit` sweeps every open batch to FAILED on the
 * assumption it is this process's own leftover, the same assumption
 * PreprocessingJobService documents.
 */
@Injectable()
export class PiWriteBackAuthorizedService implements OnModuleInit {
  private readonly log = new Logger(PiWriteBackAuthorizedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ModelEvaluationAccessService,
    private readonly config: WriteBackConfigAuthorizedService,
    private readonly scheduler: InferenceWindowSchedulerService,
  ) {}

  async onModuleInit() {
    const { count } = await this.prisma.piWriteBatch.updateMany({
      where: { status: { in: ['PENDING', 'WRITING'] } },
      data: {
        status: 'FAILED',
        error:
          'Interrupted: the server restarted during this write. Verify the tag in PI; rollback is available.',
        finishedAt: new Date(),
      },
    });
    if (count > 0) {
      this.log.warn(`Swept ${count} interrupted PI write batch(es) to FAILED.`);
    }
  }

  // ── write ────────────────────────────────────────────────────────────────

  async writeService(
    modelId: string,
    dto: WriteBackDto,
    user: Auth.UserPayload,
  ) {
    await this.access.assertWriteBack(modelId, user);

    const normalized = normalizePoints(dto.points, Date.now());
    if (normalized.error) throw refuse(422, normalized.error);
    const points = normalized.points;

    const target = await this.resolveTarget(modelId, dto.kind);
    if (dto.modelVersionId)
      await this.assertVersion(modelId, dto.modelVersionId);

    if (dto.dryRun) {
      const before = await this.snapshot(target, points);
      const busy = await this.prisma.piWriteBatch.findFirst({
        where: {
          sourceId: target.sourceId,
          tag: target.tag,
          status: { in: ['PENDING', 'WRITING'] },
        },
        select: { id: true },
      });
      const overwrites = before.filter((b) => b !== null).length;
      return {
        data: {
          dryRun: true as const,
          kind: dto.kind,
          tag: target.tag,
          sourceName: target.sourceName,
          piAccount: target.piAccount,
          pointCount: points.length,
          overwriteCount: overwrites,
          newCount: points.length - overwrites,
          busy: busy !== null,
        },
      };
    }

    // 1. claim
    let batch: BatchRow;
    try {
      batch = await this.prisma.piWriteBatch.create({
        data: {
          modelId,
          sourceId: target.sourceId,
          kind: dto.kind,
          tag: target.tag,
          rangeFrom: new Date(points[0].at),
          rangeTo: new Date(points[points.length - 1].at),
          pointCount: points.length,
          status: 'WRITING',
          modelVersionId: dto.modelVersionId ?? null,
          createdById: user.id,
          piAccount: target.piAccount,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw refuse(
          409,
          `Another write to ${target.tag} is in progress. Wait for it to finish.`,
        );
      }
      throw err;
    }

    // 2-3. snapshot, persist
    let before: Array<RecordedEvent | null>;
    try {
      before = await this.snapshot(target, points);
      await this.prisma.piWriteValue.createMany({
        data: points.map((p, i) => ({
          batchId: batch.id,
          timestamp: new Date(p.at),
          beforeExisted: before[i] !== null,
          beforeValue: before[i]?.value ?? null,
          sentValue: p.value,
          itemOk: false,
        })),
      });
    } catch (err) {
      await this.finish(batch.id, 'FAILED', `Nothing was written: ${msg(err)}`);
      throw err;
    }

    // 4. write
    let writeError: string | null = null;
    const writerByMs = new Map<number, { ok: boolean; error: string | null }>();
    try {
      const res = await piWrite({
        credentials: target.credentials,
        tag: target.tag,
        update_option: 'Replace',
        points: points.map((p) => ({ timestamp: p.iso, value: p.value })),
      });
      for (const r of res.results) {
        writerByMs.set(Date.parse(r.timestamp), {
          ok: r.ok,
          error: r.error ?? null,
        });
      }
    } catch (err) {
      writeError = msg(err);
    }

    // 5. read back (best effort even after a write error: the truth about
    //    what landed is what a rollback needs)
    let after: Array<RecordedEvent | null> | null = null;
    let readBackError: string | null = null;
    try {
      after = await this.readMatched(target, points);
    } catch (err) {
      readBackError = msg(err);
    }

    let okCount = 0;
    const results = points.map((p, i) => {
      const stored = after?.[i]?.value ?? null;
      const writer = writerByMs.get(p.at) ?? { ok: true, error: null };
      let outcome: { ok: boolean; error: string | null };
      if (writeError) {
        outcome = { ok: false, error: 'The PI write request failed.' };
      } else if (after === null) {
        outcome = {
          ok: false,
          error: 'Could not read back from PI to verify.',
        };
      } else {
        outcome = itemOutcome({
          writerOk: writer.ok,
          writerError: writer.error,
          sent: p.value,
          stored,
        });
      }
      if (outcome.ok) okCount += 1;
      return { at: p.at, afterValue: stored, ...outcome };
    });

    await this.recordResults(batch.id, results);

    const status = deriveStatus(okCount, points.length);
    const error = writeError
      ? `PI write failed: ${writeError}. Part of the batch may be stored; verify in PI. Rollback is available.`
      : readBackError
        ? `Written, but could not be verified: ${readBackError}`
        : null;
    const finished = await this.finish(batch.id, status, error);

    return {
      data: {
        dryRun: false as const,
        batch: this.summary(finished, {
          ok: okCount,
          failed: points.length - okCount,
        }),
      },
    };
  }

  // ── history ──────────────────────────────────────────────────────────────

  async listHistoryService(
    modelId: string,
    query: WriteBackHistoryQueryDto,
    user: Auth.UserPayload,
  ) {
    await this.access.assertRead(modelId, user);
    const rows = (await this.prisma.piWriteBatch.findMany({
      where: { modelId, ...(query.kind ? { kind: query.kind } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: {
        createdBy: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
      },
    })) as Array<BatchRow & { createdBy: UserLite | null }>;

    const page = rows.slice(0, query.limit);
    const counts = await this.okCounts(page.map((r) => r.id));
    return {
      data: {
        batches: page.map((r) => ({
          ...this.summary(r, counts.get(r.id) ?? { ok: 0, failed: 0 }),
          createdBy: userName(r.createdBy),
        })),
        nextCursor: rows.length > query.limit ? page[page.length - 1].id : null,
      },
    };
  }

  async getBatchService(
    modelId: string,
    batchId: string,
    user: Auth.UserPayload,
  ) {
    await this.access.assertRead(modelId, user);
    const batch = (await this.prisma.piWriteBatch.findFirst({
      where: { id: batchId, modelId },
      include: {
        createdBy: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
        values: { orderBy: { timestamp: 'asc' } },
        rollbacks: { select: { id: true, status: true, createdAt: true } },
      },
    })) as
      | (BatchRow & {
          createdBy: UserLite | null;
          values: Array<{
            timestamp: Date;
            beforeExisted: boolean;
            beforeValue: number | null;
            sentValue: number;
            afterValue: number | null;
            itemOk: boolean;
            itemError: string | null;
          }>;
          rollbacks: Array<{ id: string; status: string; createdAt: Date }>;
        })
      | null;
    if (!batch) throw refuse(404, 'Write batch not found');

    const ok = batch.values.filter((v) => v.itemOk).length;
    return {
      data: {
        batch: {
          ...this.summary(batch, { ok, failed: batch.values.length - ok }),
          createdBy: userName(batch.createdBy),
          rollbacks: batch.rollbacks.map((r) => ({
            id: r.id,
            status: r.status,
            createdAt: r.createdAt.toISOString(),
          })),
        },
        values: batch.values.map((v) => ({
          timestamp: v.timestamp.toISOString(),
          beforeExisted: v.beforeExisted,
          beforeValue: v.beforeValue,
          sentValue: v.sentValue,
          afterValue: v.afterValue,
          itemOk: v.itemOk,
          itemError: v.itemError,
        })),
      },
    };
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** Everything a write needs about its destination, re-validated NOW: the
   *  config may be older than the schedule's current source or base tags. */
  private async resolveTarget(modelId: string, kind: 'PREDICTION' | 'LAB') {
    const config = await this.prisma.modelWriteBackConfig.findUnique({
      where: { modelId },
    });
    const tag = kind === 'PREDICTION' ? config?.predictionTag : config?.labTag;
    if (!config || !tag) {
      throw refuse(
        422,
        `No ${kind === 'PREDICTION' ? 'prediction' : 'lab'} output tag is configured for this model.`,
      );
    }
    const schedule = await this.prisma.inferenceSchedule.findUnique({
      where: { modelId },
      select: { sourceId: true, fetchConfig: true },
    });
    if (!schedule) {
      throw refuse(422, 'This model has no production data source.');
    }
    if (schedule.sourceId !== config.sourceId) {
      throw refuse(
        409,
        "The model's data source changed after write-back was configured. Re-save the output tags to confirm the new destination.",
      );
    }
    const source = await this.prisma.dataSource.findUnique({
      where: { id: config.sourceId },
    });
    if (!source || source.type !== 'aveva') {
      throw refuse(
        422,
        'The configured write-back source is not an available PI source.',
      );
    }
    const targetTag = await this.config.targetTagOf(modelId);
    if (!targetTag) {
      throw refuse(
        422,
        'This model has no trained version to take a lab target from.',
      );
    }
    const fetchConfig = this.scheduler.asFetchConfig(schedule.fetchConfig);
    const rule = validateOutputTags({
      predictionTag: config.predictionTag,
      labTag: config.labTag,
      // PI names, as in WriteBackConfigService (MODEL-SERVE-037-T03).
      targetTag: fetchConfig.columnTagMap?.[targetTag] ?? targetTag,
      inputTags: fetchConfig.tags ?? [],
    });
    if (rule)
      throw refuse(422, `Write-back config is no longer valid: ${rule}`);

    return {
      tag,
      sourceId: source.id,
      sourceName: source.name,
      piAccount: source.username,
      credentials: buildPiCredentials(
        source,
        decryptSecret(source.secretCiphertext),
      ),
    };
  }

  /**
   * The destination of an EXISTING batch: the source it was written through,
   * not whatever the config points at today. A rollback must hit the tag the
   * batch wrote to, even if the config has since been changed.
   */
  async sourceContext(sourceId: string) {
    const source = await this.prisma.dataSource.findUnique({
      where: { id: sourceId },
    });
    if (!source || source.type !== 'aveva') {
      throw refuse(
        422,
        'The data source this batch was written through is no longer an available PI source, so it cannot be rolled back from here.',
      );
    }
    return {
      piAccount: source.username,
      sourceName: source.name,
      credentials: buildPiCredentials(
        source,
        decryptSecret(source.secretCiphertext),
      ),
    };
  }

  private async assertVersion(modelId: string, versionId: string) {
    const v = await this.prisma.modelVersion.findFirst({
      where: { id: versionId, modelId },
      select: { id: true },
    });
    if (!v)
      throw refuse(422, 'That model version does not belong to this model.');
  }

  /** PI events around the batch's span, matched to each point. */
  /** Shared with PiRollbackAuthorizedService. */
  async readMatched(
    target: { credentials: Record<string, unknown>; tag: string },
    points: ReadonlyArray<{ at: number }>,
  ): Promise<Array<RecordedEvent | null>> {
    const res = await piRecorded({
      credentials: target.credentials,
      tag: target.tag,
      start_time: new Date(points[0].at - MATCH_TOLERANCE_MS).toISOString(),
      end_time: new Date(
        points[points.length - 1].at + MATCH_TOLERANCE_MS,
      ).toISOString(),
      max_count: SNAPSHOT_MAX_EVENTS,
    });
    if (res.truncated) {
      throw refuse(
        422,
        `${target.tag} holds too many events in this range to snapshot exactly. Write a shorter range.`,
      );
    }
    return matchNearest(
      points.map((p) => p.at),
      res.points.map((e) => ({ at: Date.parse(e.timestamp), value: e.value })),
    );
  }

  /** The before-snapshot, refusing what a rollback could not restore. */
  private async snapshot(
    target: { credentials: Record<string, unknown>; tag: string },
    points: readonly NormalizedPoint[],
  ): Promise<Array<RecordedEvent | null>> {
    const before = await this.readMatched(target, points);
    const unrestorable = before.filter((b) => b !== null && b.value === null);
    if (unrestorable.length > 0) {
      throw refuse(
        422,
        `${unrestorable.length} existing value(s) on ${target.tag} in this range are non-numeric system states (for example I/O Timeout). A rollback could not restore them, so nothing was written.`,
      );
    }
    return before;
  }

  /** Shared with PiRollbackAuthorizedService. */
  async recordResults(
    batchId: string,
    results: Array<{
      at: number;
      afterValue: number | null;
      ok: boolean;
      error: string | null;
    }>,
  ) {
    for (let i = 0; i < results.length; i += RESULT_CHUNK) {
      const part = results.slice(i, i + RESULT_CHUNK);
      await this.prisma.$transaction(
        part.map((r) =>
          this.prisma.piWriteValue.update({
            where: {
              batchId_timestamp: { batchId, timestamp: new Date(r.at) },
            },
            data: {
              afterValue: r.afterValue,
              itemOk: r.ok,
              itemError: r.error,
            },
          }),
        ),
      );
    }
  }

  /** Shared with PiRollbackAuthorizedService. */
  async finish(
    batchId: string,
    status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED',
    error: string | null,
  ): Promise<BatchRow> {
    return await this.prisma.piWriteBatch.update({
      where: { id: batchId },
      data: { status, error, finishedAt: new Date() },
    });
  }

  private async okCounts(batchIds: string[]) {
    const out = new Map<string, { ok: number; failed: number }>();
    if (batchIds.length === 0) return out;
    const grouped = await this.prisma.piWriteValue.groupBy({
      by: ['batchId', 'itemOk'],
      where: { batchId: { in: batchIds } },
      _count: { _all: true },
    });
    for (const g of grouped) {
      const cur = out.get(g.batchId) ?? { ok: 0, failed: 0 };
      if (g.itemOk) cur.ok += g._count._all;
      else cur.failed += g._count._all;
      out.set(g.batchId, cur);
    }
    return out;
  }

  /** Shared with PiRollbackAuthorizedService. */
  summary(b: BatchRow, counts: { ok: number; failed: number }) {
    return {
      id: b.id,
      kind: b.kind,
      tag: b.tag,
      status: b.status,
      pointCount: b.pointCount,
      okCount: counts.ok,
      failedCount: counts.failed,
      rangeFrom: b.rangeFrom.toISOString(),
      rangeTo: b.rangeTo.toISOString(),
      modelVersionId: b.modelVersionId,
      rollbackOfId: b.rollbackOfId,
      piAccount: b.piAccount,
      error: b.error,
      createdAt: b.createdAt.toISOString(),
      finishedAt: b.finishedAt?.toISOString() ?? null,
    };
  }
}

type UserLite = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
};

function userName(u: UserLite | null): string | null {
  if (!u) return null;
  const full = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return full || u.email;
}
