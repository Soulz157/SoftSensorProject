import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService, PrismaTypes } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import { postToPython, PYTHON_TIMEOUT } from '@/lib/python-client';
import {
  tmpKey,
  tmpPrefix as tmpPrefixFor,
  artifactKey,
} from '@/lib/artifact-keys';
import {
  ArtifactStatsSchema,
  CreateFeaturesSchema,
  ExportStatsSchema,
  PythonCleanupSchema,
  type ArtifactStats,
  type CleaningOperation,
  type FeatureConfig,
} from './dto/dataset-version.authorized.dto';

/**
 * In-process runner for preprocessing jobs.
 *
 * No queue is introduced (CLAUDE.md §11): there is no Redis, BullMQ or Celery
 * in this repo to reuse — verified, not assumed — and adding one for a single
 * job type would be new infrastructure for a workload that a Postgres row plus
 * an in-memory token already covers.
 *
 * Shape of a run
 * --------------
 * One `postToPython` call PER OPERATION, chaining object keys through
 * `{datasetId}/tmp/{jobId}/`. That buys real per-operation progress, natural
 * cancellation points, and keeps every individual call far inside its timeout
 * instead of one five-minute request. The cost is extra round trips to storage;
 * the intermediates are deleted on success.
 *
 *   QUEUED --> RUNNING --> SUCCEEDED
 *                |   \---> FAILED    (error recorded, tmp KEPT for debugging)
 *                \-------> CANCELED  (tmp deleted)
 *
 * The commit
 * ----------
 * The LAST operation writes straight to the committed version key, then the
 * DatasetVersion row and the job's SUCCEEDED status are written in one
 * `$transaction`. There is no promote/copy step — it would double the I/O for a
 * window that cannot be closed anyway. Two consequences worth knowing:
 *
 *   * a crash between the artifact write and the transaction leaves an ORPHAN
 *     object at the version key. It is unreferenced, not corrupt.
 *   * because that key may already exist and committed keys are immutable, a
 *     RETRY must mint a NEW versionId rather than reuse the failed one. That
 *     falls out of retry creating a new job row, since the id is minted here.
 *
 * SINGLE REPLICA ONLY
 * -------------------
 * `onModuleInit` sweeps every RUNNING row to FAILED, on the assumption that
 * such a row can only be this process's own leftover from a hard kill. With two
 * replicas, a boot would kill the other replica's live jobs. The escape hatch is
 * `SELECT ... FOR UPDATE SKIP LOCKED` plus an owner column — still no Redis.
 */

/**
 * How long to wait before re-clearing a cancelled job's tmp prefix. Sized to
 * outlast one connector step on a large artifact, not to be a guarantee.
 */
const STRAGGLER_SWEEP_MS = 30_000;

interface StepProgress {
  completedSteps: number;
  totalSteps: number;
  currentStep: string;
  startedAt: number;
}

@Injectable()
export class PreprocessingJobService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(PreprocessingJobService.name);

  private readonly running = new Map<string, AbortController>();

  private shuttingDown = false;

  constructor(private readonly prisma: PrismaService) {}

  // ── lifecycle ────────────────────────────────────────────────────────────

  async onModuleInit() {
    const { count } = await this.prisma.preprocessingJob.updateMany({
      where: { status: 'RUNNING' },
      data: {
        status: 'FAILED',
        error: 'Interrupted — the server restarted while this job was running.',
        finishedAt: new Date(),
      },
    });
    if (count > 0) {
      this.logger.warn(
        `Swept ${count} interrupted preprocessing job(s) to FAILED.`,
      );
    }
  }

  async onApplicationShutdown() {
    this.shuttingDown = true;
    const ids = [...this.running.keys()];
    for (const controller of this.running.values()) controller.abort();
    this.running.clear();

    if (ids.length === 0) return;
    await this.prisma.preprocessingJob.updateMany({
      where: { id: { in: ids }, status: 'RUNNING' },
      data: {
        status: 'FAILED',
        error: 'Interrupted by server shutdown.',
        finishedAt: new Date(),
      },
    });
  }

  // ── control ──────────────────────────────────────────────────────────────

  start(jobId: string): void {
    void this.run(jobId).catch((err: unknown) => {
      this.logger.error(`Job ${jobId} failed outside its own handler`, err);
    });
  }

  cancel(jobId: string): boolean {
    const controller = this.running.get(jobId);
    if (!controller) return false;
    controller.abort();
    this.running.delete(jobId);
    return true;
  }

  isRunning(jobId: string): boolean {
    return this.running.has(jobId);
  }

  // ── the run ──────────────────────────────────────────────────────────────

  private async run(jobId: string): Promise<void> {
    const job = await this.prisma.preprocessingJob.findUnique({
      where: { id: jobId },
      include: {
        sourceVersion: { include: { artifact: true } },
        sourceArtifact: true,
      },
    });
    // DS-LAKE-005: jobs now read an ARTIFACT. `sourceVersion` is still accepted
    // so a job row queued before this change still runs rather than being
    // stranded by a deploy. DS-LAKE-009-T07: the registry reshape moved
    // `objectKey` OFF DatasetVersion onto DatasetArtifact — a legacy
    // `sourceVersion` now resolves its key through its OWN `artifact`
    // pointer instead (hence `include`-ing it above), not a column it no
    // longer has.
    const sourceObjectKey =
      job?.sourceArtifact?.objectKey ??
      job?.sourceVersion?.artifact?.objectKey ??
      null;
    if (!job || !sourceObjectKey) {
      this.logger.error(
        `Job ${jobId} has no source artifact; refusing to run.`,
      );
      return;
    }

    // Draft-first: a job belongs to a DRAFT while the wizard is open, or to a
    // DATASET once one exists. That owner also names the object-key namespace,
    // so draft output lands under drafts/{draftId}/ and cannot collide with a
    // saved dataset's keys.
    //
    // The CHECK constraint guarantees one of the two is set. TypeScript cannot
    // see a database constraint, and a non-null assertion here would quietly
    // become a lie if that constraint were ever dropped — so this is a real
    // runtime guard that refuses the job instead.
    const scope =
      job.datasetId ?? (job.draftId ? `drafts/${job.draftId}` : null);
    if (!scope) {
      this.logger.error(
        `Job ${jobId} is owned by neither a dataset nor a draft; refusing to run.`,
      );
      return;
    }

    // FEATURE (DS-LAKE-006-T06 reversal — feature engineering now runs as a
    // job, matching CLEAN, per an explicit user decision recorded in
    // feature_list.preprocessing.json). One combined Python call, not a
    // per-operation chain like CLEAN — there is no meaningful per-step
    // progress, so totalSteps is honestly 1, not features.length; a jump
    // from 0% to 100% in one tick is what "one call" actually looks like,
    // not a stall to hide.
    const isFeatureJob = job.stage === 'FEATURE';
    const isExportJob = job.stage === 'EXPORT';

    const controller = new AbortController();
    this.running.set(jobId, controller);

    const startedAt = Date.now();
    // Minted up front so the final step can write directly to its key.
    const artifactId = randomUUID();
    // DS-LAKE-005 writes the committed SILVER (or, for a FEATURE job, GOLD)
    // output into the artifact layout.
    //
    // Renamed off `versionKey`/`tmpPrefix` because those are now imported
    // helpers, and `tmpPrefix` is also a parameter name in `recordFailure`.
    const artifactType = isFeatureJob
      ? 'GOLD'
      : isExportJob
        ? 'EXPORT'
        : 'SILVER';
    // EXPORT never writes through `committedKey` — Python computes its own
    // sidecar key from the SOURCE artifact's own data key (see
    // EXPORT_CSV_FILENAME's doc comment in artifact-keys.ts) — so this stays
    // narrowed to the two values `artifactKey()` actually accepts rather than
    // widening that function's signature for a value it would never use.
    const committedKey = artifactKey(
      scope,
      artifactId,
      isFeatureJob ? 'GOLD' : 'SILVER',
    );
    const jobTmpPrefix = tmpPrefixFor(scope, jobId);

    // Read (and, for FEATURE, re-validate) the stored recipe BEFORE the
    // RUNNING transition, but inside its own try/catch: `readOperations`/
    // `readFeatureRecipe` now THROW on a shape mismatch (belt-and-suspenders
    // against the wrong reader ever reaching the wrong stage's payload) —
    // letting that throw escape uncaught here would skip both the RUNNING
    // AND the FAILED writes, leaving the row stuck at QUEUED forever
    // (`start()`'s outer catch only logs). Routing it through the SAME
    // `recordFailure` every other failure uses keeps this one terminal
    // state, not a silent stall.
    let operations: CleaningOperation[] = [];
    let precision: Record<string, number> = {};
    let featureRecipe: {
      features: FeatureConfig[];
      selectedColumns: string[] | null;
      scalers: Record<string, string>;
      targetY: string | null;
    } | null = null;
    try {
      if (isFeatureJob) {
        featureRecipe = this.readFeatureRecipe(job.operations);
      } else if (isExportJob) {
        this.readExportRequest(job.operations);
      } else {
        operations = this.readOperations(job.operations);
        precision = this.readPrecision(job.operations);
      }
    } catch (err) {
      this.running.delete(jobId);
      await this.recordFailure(jobId, jobTmpPrefix, controller, err);
      return;
    }
    const totalSteps = isFeatureJob || isExportJob ? 1 : operations.length;

    await this.prisma.preprocessingJob.update({
      where: { id: jobId },
      data: {
        status: 'RUNNING',
        startedAt: new Date(),
        totalSteps,
        completedSteps: 0,
        progress: 0,
        attempts: { increment: 1 },
      },
    });

    try {
      let stats: ArtifactStats | null = null;

      if (isFeatureJob) {
        const recipe = featureRecipe!;
        this.assertNotCanceled(controller);
        await this.reportStep(jobId, {
          completedSteps: 0,
          totalSteps: 1,
          currentStep: 'features',
          startedAt,
        });

        // Field casing mirrors the inline `/features` route exactly
        // (`createDraftFeaturesArtifactService`) — Python's FeaturesRequest
        // accepts `selectedColumns` camelCase despite `source_key`/
        // `target_key` being snake_case; this is not a typo to "fix".
        stats = ArtifactStatsSchema.parse(
          await postToPython(
            '/v1/preprocess/features',
            {
              source_key: sourceObjectKey,
              target_key: committedKey,
              features: recipe.features,
              selectedColumns: recipe.selectedColumns,
              scalers: recipe.scalers,
              overwrite: false,
              target_y: recipe.targetY,
            },
            PYTHON_TIMEOUT.preprocess,
            controller.signal,
          ),
        );
      } else if (isExportJob) {
        this.assertNotCanceled(controller);
        await this.reportStep(jobId, {
          completedSteps: 0,
          totalSteps: 1,
          currentStep: 'export',
          startedAt,
        });

        const exportStats = ExportStatsSchema.parse(
          await postToPython(
            '/v1/preprocess/export',
            { source_key: sourceObjectKey },
            PYTHON_TIMEOUT.preprocess,
            controller.signal,
          ),
        );
        // Reused as ArtifactStats below (commit() takes one shape) —
        // missing_pct/column_stats_key have no export equivalent, so
        // they're filled with the same "not applicable" defaults every
        // other optional field with nothing to report already uses.
        stats = {
          object_key: exportStats.object_key,
          row_count: exportStats.row_count,
          column_count: exportStats.column_count,
          size_bytes: exportStats.size_bytes,
          missing_pct: 0,
          checksum: exportStats.checksum,
          duration_ms: Date.now() - startedAt,
          column_stats_key: null,
        };
      } else {
        let sourceKey = sourceObjectKey;

        for (const [index, operation] of operations.entries()) {
          this.assertNotCanceled(controller);

          const isLast = index === operations.length - 1;
          // Only the final step writes the committed key; earlier ones go to
          // tmp so a failure leaves each stage intact and inspectable.
          const targetKey = isLast
            ? committedKey
            : tmpKey(scope, jobId, index + 1);

          await this.reportStep(jobId, {
            completedSteps: index,
            totalSteps: operations.length,
            currentStep: this.describe(operation),
            startedAt,
          });

          stats = ArtifactStatsSchema.parse(
            await postToPython(
              '/v1/preprocess/clean',
              {
                source_key: sourceKey,
                target_key: targetKey,
                operations: [operation],
                precision,
                // tmp steps may be rewritten by a retry; a committed key never.
                overwrite: !isLast,
              },
              PYTHON_TIMEOUT.preprocess,
              controller.signal,
            ),
          );

          sourceKey = targetKey;
        }
      }

      this.assertNotCanceled(controller);
      if (!stats) {
        throw new AppException({
          statusCode: 400,
          message: isFeatureJob
            ? 'Feature engineering produced no result.'
            : isExportJob
              ? 'Export produced no result.'
              : 'A cleaning job needs at least one operation.',
          type: 'ERROR',
        });
      }

      // The SILVER (or GOLD) output joins its parent's run, so the whole
      // chain shares one runId. A legacy version-sourced job has no run to
      // join, so it starts one rather than inventing a shared id.
      await this.commit(
        job,
        artifactId,
        stats,
        isFeatureJob ? featureRecipe!.features : operations,
        isFeatureJob || isExportJob ? 1 : operations.length,
        startedAt,
        job.sourceArtifact?.runId ?? randomUUID(),
        artifactType,
        isFeatureJob ? (stats.feature_spec_key ?? null) : null,
      );
      await this.clearTmp(jobTmpPrefix);
    } catch (err) {
      await this.recordFailure(jobId, jobTmpPrefix, controller, err);
    } finally {
      this.running.delete(jobId);
    }
  }

  /**
   * The version row and the job's terminal status must land together: a
   * committed version whose job still reads RUNNING, and a SUCCEEDED job with
   * no version, are both states the UI cannot recover from (CLAUDE.md §5).
   */
  private async commit(
    job: {
      id: string;
      datasetId: string | null;
      draftId: string | null;
      createdById: string;
      sourceArtifactId: string | null;
    },
    artifactId: string,
    stats: ArtifactStats,
    operations: CleaningOperation[] | FeatureConfig[],
    completedSteps: number,
    startedAt: number,
    runId: string,
    artifactType: 'SILVER' | 'GOLD' | 'EXPORT',
    featureSpecKey: string | null,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // DS-LAKE-005: this commits a SILVER (or, since the FEATURE-job
      // reversal, GOLD) ARTIFACT, not a DatasetVersion. A pipeline run is a
      // stage; only Save Dataset creates a version (DS-LAKE-009).
      // `currentVersionId` is deliberately not touched.
      //
      // The version-number read that used to live here is gone with it: the
      // artifact table has no per-dataset sequence to collide on, so two
      // concurrent jobs no longer contend for the same number.
      const artifact = await tx.datasetArtifact.create({
        data: {
          id: artifactId,
          datasetId: job.datasetId,
          draftId: job.draftId,
          runId,
          parentArtifactId: job.sourceArtifactId,
          type: artifactType,
          objectKey: stats.object_key,
          checksum: stats.checksum,
          rowCount: stats.row_count,
          columnCount: stats.column_count,
          missingPct: stats.missing_pct,
          sizeBytes: BigInt(stats.size_bytes),
          operations,
          // /clean always writes column_stats.json; /features does not (a
          // cleaning-op concern it has nothing to compute — same reasoning
          // the inline features route already documents), so this is null
          // for every GOLD row exactly as it is for the inline path today.
          columnStatsKey: stats.column_stats_key,
          featureSpecKey,
          durationMs: Date.now() - startedAt,
          createdById: job.createdById,
        },
      });

      await tx.preprocessingJob.update({
        where: { id: job.id },
        data: {
          status: 'SUCCEEDED',
          progress: 100,
          completedSteps,
          currentStep: null,
          estimatedRemainingMs: 0,
          resultArtifactId: artifact.id,
          finishedAt: new Date(),
        },
      });

      // The pointer follows the owner. A draft-time run advances the DRAFT so
      // the wizard hydrates from it; only a post-save run touches the Dataset.
      //
      // EXPORT is excluded: it is a read-only CSV rendering of an
      // already-committed artifact, not a new stage in the lineage chain —
      // advancing the live pointer to it would point wizard hydration,
      // the next job's source, and model training at a CSV rather than the
      // artifact that was actually current before this job ran.
      if (artifactType !== 'EXPORT') {
        if (job.datasetId) {
          await tx.dataset.update({
            where: { id: job.datasetId },
            data: { currentArtifactId: artifact.id },
          });
        } else if (job.draftId) {
          await tx.datasetDraft.update({
            where: { id: job.draftId },
            data: { currentArtifactId: artifact.id },
          });
        }
      }
    });
  }

  private async recordFailure(
    jobId: string,
    tmpPrefix: string,
    controller: AbortController,
    err: unknown,
  ): Promise<void> {
    // A shutdown aborts the same token a user cancel does, so `aborted` alone
    // cannot tell them apart — and this write lands AFTER the shutdown sweep,
    // so getting it wrong here is what the user ends up reading.
    const interrupted = this.shuttingDown;
    const canceled = controller.signal.aborted && !interrupted;

    if (canceled) {
      // Nothing was committed, so the intermediates are pure waste.
      await this.clearTmp(tmpPrefix);
      // Aborting the HTTP call does NOT stop the connector: it already has the
      // request and finishes that step server-side, writing its output AFTER
      // the sweep above. Observed live — a cancel left one straggler behind.
      this.scheduleStragglerSweep(tmpPrefix);
    } else if (interrupted) {
      // No cleanup call during shutdown: the process is going away, the
      // request would likely fail anyway, and the intermediates are useful for
      // working out how far the job got before it was killed.
      this.logger.warn(`Job ${jobId} interrupted by shutdown; keeping tmp.`);
    } else {
      // Deliberately KEPT on failure: the partial artifacts are the only
      // evidence of which step went wrong and what it produced.
      this.logger.warn(
        `Job ${jobId} failed; leaving ${tmpPrefix} in place for inspection.`,
      );
    }

    await this.prisma.preprocessingJob.update({
      where: { id: jobId },
      data: {
        status: canceled ? 'CANCELED' : 'FAILED',
        error: canceled
          ? 'Canceled by the user.'
          : interrupted
            ? 'Interrupted by server shutdown.'
            : this.readMessage(err),
        currentStep: null,
        finishedAt: new Date(),
      },
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private assertNotCanceled(controller: AbortController): void {
    if (controller.signal.aborted) {
      throw new AppException({
        statusCode: 499,
        message: 'Job canceled.',
        type: 'ERROR',
      });
    }
  }

  private async reportStep(jobId: string, step: StepProgress): Promise<void> {
    // Progress is per OPERATION, not per row: one operation over millions of
    // rows shows no movement until it finishes. Recorded as a known limitation
    // rather than faked with a timer, which would be worse — a bar that moves
    // while nothing happens is a lie the user cannot detect.
    const elapsed = Date.now() - step.startedAt;
    const remaining = step.totalSteps - step.completedSteps;
    const perStep =
      step.completedSteps > 0 ? elapsed / step.completedSteps : null;

    await this.prisma.preprocessingJob.update({
      where: { id: jobId },
      data: {
        progress: Math.round((step.completedSteps / step.totalSteps) * 100),
        completedSteps: step.completedSteps,
        currentStep: step.currentStep,
        estimatedRemainingMs: perStep ? Math.round(perStep * remaining) : null,
      },
    });
  }

  /**
   * Re-clear a cancelled job's tmp prefix once, after the connector has had
   * time to finish the step that was in flight when the abort landed.
   *
   * Deliberately fire-and-forget and `unref`ed: it must not hold the process
   * open at shutdown, and a straggler that outlives the window is an
   * unreferenced object under `tmp/` — wasted storage, never wrong data. The
   * alternative, blocking the cancel until the connector responds, would make
   * "cancel" wait on the very work the user asked to stop.
   */
  private scheduleStragglerSweep(prefix: string): void {
    const timer = setTimeout(() => {
      void this.clearTmp(prefix);
    }, STRAGGLER_SWEEP_MS);
    timer.unref();
  }

  private async clearTmp(prefix: string): Promise<void> {
    try {
      PythonCleanupSchema.parse(
        await postToPython(
          '/v1/preprocess/cleanup',
          { prefix },
          PYTHON_TIMEOUT.metadata,
        ),
      );
    } catch (err) {
      // Best effort. Orphaned intermediates cost storage, not correctness, and
      // failing over them would turn a successful run into a failed one.
      this.logger.warn(`Could not clear ${prefix}: ${this.readMessage(err)}`);
    }
  }

  private describe(operation: CleaningOperation): string {
    return operation.method
      ? `${operation.type}/${operation.method}`
      : operation.type;
  }

  /**
   * `PreprocessingJob.operations` stores `{ operations, precision }` together,
   * because precision is part of the recipe that produced a version and has to
   * replay with it. Older rows may hold a bare array.
   */
  private readOperations(raw: PrismaTypes.JsonValue): CleaningOperation[] {
    // `run()` branches on `job.stage` before either reader is ever called,
    // so this never SHOULD see a FEATURE payload — this guard is
    // belt-and-suspenders against that branch being wrong or bypassed in a
    // future edit. Without it, a `{features: [...]}` payload has no
    // `operations` key, `list` falls through to `undefined`, and this would
    // silently return `[]` — a job that runs, writes an artifact with zero
    // operations applied, and reports SUCCEEDED. Refusing loudly is the only
    // safe failure mode for a payload shape this reader does not recognize.
    const payload = Array.isArray(raw)
      ? null
      : (raw as { operations?: unknown; features?: unknown } | null);
    if (
      payload &&
      payload.features !== undefined &&
      payload.operations === undefined
    ) {
      throw new AppException({
        statusCode: 500,
        message:
          'Stored job payload is a feature recipe, not a cleaning pipeline — refusing to run as CLEAN.',
        type: 'ERROR',
      });
    }
    const list = Array.isArray(raw) ? raw : payload?.operations;
    // Shape is not re-validated here: the same array was zod-parsed by
    // `StartCleanJobSchema` on the way in, and Python rejects an unknown
    // operation with an actionable 422 regardless.
    return Array.isArray(list) ? (list as CleaningOperation[]) : [];
  }

  private readPrecision(raw: PrismaTypes.JsonValue): Record<string, number> {
    if (Array.isArray(raw) || raw === null) return {};
    const payload = raw as { precision?: Record<string, number> };
    return payload?.precision ?? {};
  }

  /**
   * `PreprocessingJob.operations` stores `{ features, selectedColumns,
   * scalers }` for a FEATURE-stage job — the same shape `CreateFeaturesDto`
   * validates on the inline `/features` route (`startDraftFeaturesJobService`
   * writes it verbatim), re-validated here with the SAME zod schema so a
   * corrupt or hand-edited row fails loudly instead of running with
   * silently-dropped fields.
   *
   * Never called for a CLEAN job — `run()` branches on `job.stage` before
   * either reader runs — but this still actively refuses a CLEAN-shaped
   * payload (has `operations`, not `features`) rather than coercing it to an
   * empty recipe, mirroring `readOperations`'s own refusal in the other
   * direction. The failure mode this exists to prevent: a FEATURE job that
   * SUCCEEDS with zero features computed, committing a GOLD artifact that
   * looks fine and is not — worse than today's inline 422, because nothing
   * about it looks like a failure.
   */
  private readFeatureRecipe(raw: PrismaTypes.JsonValue): {
    features: FeatureConfig[];
    selectedColumns: string[] | null;
    scalers: Record<string, string>;
    targetY: string | null;
  } {
    if (Array.isArray(raw) || !raw || typeof raw !== 'object') {
      throw new AppException({
        statusCode: 500,
        message:
          'Stored job payload is not a feature recipe — refusing to run as FEATURE.',
        type: 'ERROR',
      });
    }
    const payload = raw as {
      operations?: unknown;
      features?: unknown;
      selectedColumns?: unknown;
      scalers?: unknown;
      targetY?: unknown;
    };
    if (payload.operations !== undefined && payload.features === undefined) {
      throw new AppException({
        statusCode: 500,
        message:
          'Stored job payload is a cleaning pipeline, not a feature recipe — refusing to run as FEATURE.',
        type: 'ERROR',
      });
    }
    const parsed = CreateFeaturesSchema.safeParse({
      features: payload.features ?? [],
      selectedColumns: payload.selectedColumns ?? null,
      scalers: payload.scalers ?? {},
      targetY: payload.targetY ?? null,
    });
    if (!parsed.success) {
      throw new AppException({
        statusCode: 500,
        message: 'Stored feature recipe failed validation — refusing to run.',
        type: 'ERROR',
      });
    }
    return {
      features: parsed.data.features,
      selectedColumns: parsed.data.selectedColumns ?? null,
      scalers: parsed.data.scalers,
      targetY: parsed.data.targetY ?? null,
    };
  }

  /**
   * `PreprocessingJob.operations` stores `{ kind: 'export' }` for an
   * EXPORT-stage job — nothing else to configure, unlike CLEAN/FEATURE.
   * Never called for a CLEAN or FEATURE job — `run()` branches on
   * `job.stage` before any reader runs — but still actively refuses any
   * other shape rather than coercing, mirroring `readOperations`/
   * `readFeatureRecipe`'s own refusal discipline.
   */
  private readExportRequest(raw: PrismaTypes.JsonValue): void {
    const payload = Array.isArray(raw)
      ? null
      : (raw as { kind?: unknown } | null);
    if (!payload || payload.kind !== 'export') {
      throw new AppException({
        statusCode: 500,
        message:
          'Stored job payload is not an export request — refusing to run as EXPORT.',
        type: 'ERROR',
      });
    }
  }

  /**
   * Never surface a raw error. `AppException` messages are ours and safe; an
   * arbitrary throw can carry connector detail, and this string is persisted on
   * the job row and shown to the user.
   */
  private readMessage(err: unknown): string {
    if (err instanceof AppException) return err.message;
    return 'Preprocessing failed. See the server logs for details.';
  }
}
