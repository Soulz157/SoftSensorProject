import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '@softsensor/prisma';
import { postToPython, PYTHON_TIMEOUT } from '@/lib/python-client';
import { env } from '@/config/env.config';
import {
  reportModelDraftEligibility,
  type ModelDraftCleanupCandidate,
  type ModelDraftCleanupSkipReason,
  type ModelDraftCleanupTier,
} from '@/lib/model-draft-cleanup-eligibility';
import { PythonDraftRunReclaimSchema } from './dto/model-draft-cleanup.admin.dto';

export interface ModelDraftCleanupResultItem {
  draftId: string;
  tier: ModelDraftCleanupTier;
  deletedObjects?: number;
  error?: string;
}

export interface ModelDraftCleanupRunResult {
  dryRun: boolean;
  scanned: number;
  eligible: number;
  reclaimed: number;
  failed: number;
  skipped: Record<ModelDraftCleanupSkipReason, number>;
  drafts: ModelDraftCleanupResultItem[];
}

/**
 * MODEL-FLOW-011: closes the ModelDraft-side twin of the DS-LAKE-014 hole —
 * nothing called `/abandon` or reclaimed a ModelDraft's run objects on a
 * user's behalf. Mirrors `ArtifactCleanupAdminService`'s own shape
 * end-to-end: `onModuleInit` registers a `setInterval(...).unref()`
 * (`MODEL_DRAFT_SWEEP_INTERVAL_MS <= 0` disables it, admin endpoint
 * unaffected either way), `sweep()` is the timer's own private entrypoint
 * (never called by the admin route, which calls `run()` directly) and
 * swallows its own errors so a failed tick never crashes the process and
 * leaves everything it would have reclaimed eligible for the next one.
 *
 * Two writes per eligible draft, not one: `reportModelDraftEligibility`
 * decides tier and reclaim shape; this service deletes bytes FIRST via
 * Python, then stamps `status`/`objectsReclaimedAt` SECOND — same ordering
 * `ArtifactCleanupAdminService.run()` uses and the same reason: a
 * stamp-first crash orphans bytes forever, while delete-first leaves the
 * row eligible next tick (`delete_prefix` on an absent prefix returns `0`
 * rather than erroring).
 *
 * SINGLE REPLICA ONLY, same assumption `ArtifactCleanupAdminService`
 * documents for itself: overlap between two replicas' timers is wasteful,
 * not corrupting — the query is naturally idempotent — so no lock is added.
 */
@Injectable()
export class ModelDraftCleanupAdminService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(ModelDraftCleanupAdminService.name);

  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    const intervalMs = env.MODEL_DRAFT_SWEEP_INTERVAL_MS;
    if (intervalMs <= 0) {
      this.logger.log(
        'ModelDraft cleanup sweep disabled (MODEL_DRAFT_SWEEP_INTERVAL_MS ' +
          '<= 0) — the admin endpoint remains the only trigger.',
      );
      return;
    }
    this.sweepTimer = setInterval(() => {
      void this.sweep();
    }, intervalMs);
    this.sweepTimer.unref();
    this.logger.log(
      `ModelDraft cleanup sweep scheduled every ${intervalMs}ms.`,
    );
  }

  onApplicationShutdown(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  /**
   * The interval timer's own entrypoint — never called by the admin
   * endpoint, which calls `run()` directly. A failure is logged and
   * swallowed here: a failed sweep must never crash the process, and
   * everything it would have reclaimed stays eligible for the next tick.
   */
  private async sweep(): Promise<void> {
    try {
      await this.run({ dryRun: false, trigger: 'interval' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `ModelDraft cleanup sweep failed, will retry next tick: ${message}`,
      );
    }
  }

  async run(options: {
    dryRun: boolean;
    /** Threaded into the summary log line so a sweep that fired on its own
     * is distinguishable from an admin-triggered run. Defaults to 'admin' —
     * the controller does not need to pass it. */
    trigger?: 'admin' | 'interval';
  }): Promise<ModelDraftCleanupRunResult> {
    const trigger = options.trigger ?? 'admin';

    const candidates = await this.prisma.modelDraft.findMany({
      where: {
        OR: [
          { status: 'ACTIVE' },
          { status: 'ABANDONED', objectsReclaimedAt: null },
        ],
      },
      select: {
        id: true,
        status: true,
        updatedAt: true,
        objectsReclaimedAt: true,
        trainingRuns: { select: { id: true, status: true, modelId: true } },
        candidateJobs: {
          where: { status: { in: ['QUEUED', 'RUNNING'] } },
          select: { status: true },
        },
      },
    });

    const eligibilityInput: ModelDraftCleanupCandidate[] = candidates.map(
      (draft) => ({
        id: draft.id,
        status: draft.status,
        updatedAt: draft.updatedAt,
        objectsReclaimedAt: draft.objectsReclaimedAt,
        runs: draft.trainingRuns,
        candidateJobs: draft.candidateJobs,
      }),
    );

    const report = reportModelDraftEligibility(
      eligibilityInput,
      {
        emptyIdleHours: env.MODEL_DRAFT_EMPTY_IDLE_HOURS,
        runsIdleHours: env.MODEL_DRAFT_RUNS_IDLE_HOURS,
        abandonedRecoveryHours: env.MODEL_DRAFT_ABANDONED_RECOVERY_HOURS,
      },
      new Date(),
    );

    const results: ModelDraftCleanupResultItem[] = [];
    let reclaimed = 0;
    let failed = 0;

    for (const item of report.eligible) {
      if (options.dryRun) {
        results.push({ draftId: item.draftId, tier: item.tier });
        continue;
      }

      // Reclaim bytes FIRST, stamp status/objectsReclaimedAt SECOND — see
      // the class doc comment. One reclaim call: the whole subtree when
      // nothing on the draft is adopted (also the shape that catches a run
      // prefix whose ModelTrainingRun row is already gone), otherwise one
      // call per unadopted run so an adopted run's prefix is never named.
      let deletedTotal = 0;
      let reclaimFailed = false;
      let lastError = '';

      try {
        if (item.reclaim.subtree) {
          const response = PythonDraftRunReclaimSchema.parse(
            await postToPython(
              '/v1/preprocess/models/runs/reclaim',
              { draft_id: item.draftId, run_id: null },
              PYTHON_TIMEOUT.metadata,
            ),
          );
          deletedTotal += response.deleted;
        } else {
          for (const runId of item.reclaim.runIds) {
            const response = PythonDraftRunReclaimSchema.parse(
              await postToPython(
                '/v1/preprocess/models/runs/reclaim',
                { draft_id: item.draftId, run_id: runId },
                PYTHON_TIMEOUT.metadata,
              ),
            );
            deletedTotal += response.deleted;
          }
        }
      } catch (err) {
        reclaimFailed = true;
        lastError = err instanceof Error ? err.message : String(err);
      }

      if (reclaimFailed) {
        failed += 1;
        this.logger.warn(
          `Could not reclaim draft ${item.draftId}'s run objects: ${lastError}`,
        );
        results.push({
          draftId: item.draftId,
          tier: item.tier,
          error: lastError,
        });
        continue;
      }

      try {
        await this.stampReclaimed(item.draftId);
        reclaimed += 1;
        results.push({
          draftId: item.draftId,
          tier: item.tier,
          deletedObjects: deletedTotal,
        });
      } catch (err) {
        failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Reclaimed draft ${item.draftId}'s run objects but could NOT ` +
            `stamp status/objectsReclaimedAt after a retry — the row now ` +
            `understates reality until the next run's retry converges it ` +
            `(idempotent delete): ${message}`,
        );
        results.push({
          draftId: item.draftId,
          tier: item.tier,
          deletedObjects: deletedTotal,
          error: message,
        });
      }
    }

    this.logger.log(
      `ModelDraft cleanup sweep (trigger=${trigger}, dryRun=${options.dryRun}): ` +
        `examined ${candidates.length}, reclaimed ${reclaimed}, failed ` +
        `${failed}, skipped ${JSON.stringify(report.skipped)}.`,
    );

    return {
      dryRun: options.dryRun,
      scanned: candidates.length,
      eligible: report.eligible.length,
      reclaimed,
      failed,
      skipped: report.skipped,
      drafts: results,
    };
  }

  /**
   * Writes `status: 'ABANDONED'` (a no-op transition if already ABANDONED
   * via the Remove button) plus `objectsReclaimedAt`, retrying once on
   * failure — only ever called AFTER Python has confirmed the objects are
   * gone, same reasoning `ArtifactCleanupAdminService.stampReclaimed` states
   * for its own single immediate retry.
   */
  private async stampReclaimed(draftId: string): Promise<void> {
    const data = {
      status: 'ABANDONED' as const,
      objectsReclaimedAt: new Date(),
    };
    try {
      await this.prisma.modelDraft.update({ where: { id: draftId }, data });
    } catch {
      await this.prisma.modelDraft.update({ where: { id: draftId }, data });
    }
  }
}
