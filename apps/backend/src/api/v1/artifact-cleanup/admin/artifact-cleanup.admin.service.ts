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
  reportCleanupEligibility,
  type CleanupDraftInfo,
  type CleanupSkipReason,
} from '@/lib/artifact-cleanup-eligibility';
import { PythonArtifactReclaimSchema } from './dto/artifact-cleanup.admin.dto';

export interface ArtifactCleanupResultItem {
  id: string;
  objectKey: string;
  type: string;
  deletedObjects?: number;
  error?: string;
}

/**
 * DS-LAKE-014-T05: the eligibility predicate's own four reasons
 * (`CleanupSkipReason`), plus `active_job` — a live-reference check this
 * SERVICE makes on top of the predicate's eligible set, so it can't be
 * attributed inside the pure predicate itself (an active `PreprocessingJob`
 * reference has nothing to do with age or lineage).
 */
export type ArtifactCleanupSkipCounts = Record<CleanupSkipReason, number> & {
  active_job: number;
};

export interface ArtifactCleanupRunResult {
  dryRun: boolean;
  scanned: number;
  eligible: number;
  reclaimed: number;
  failed: number;
  /**
   * DS-LAKE-014-T05: total bytes reclaimed this run, summed from
   * `DatasetArtifact.sizeBytes` over every artifact Python confirmed
   * deleted (independent of whether its stamp write also succeeded — see
   * the `run()` loop). A `string`, not a `bigint`: `bigint` does not survive
   * `JSON.stringify` and this value crosses the wire in the controller's
   * response body.
   */
  bytesReclaimed: string;
  /**
   * DS-LAKE-014-T05: why every non-reclaimed candidate was skipped, broken
   * down by reason, so a sweep that reclaims nothing is distinguishable
   * from a sweep that found nothing.
   */
  skipped: ArtifactCleanupSkipCounts;
  /**
   * DS-LAKE-014-T02: ACTIVE drafts with zero live artifacts, auto-abandoned
   * this run because their `updatedAt` cleared
   * `CLEANUP_ACTIVE_EMPTY_MINUTES`. A draft-level status transition, not an
   * object reclaim — there are no MinIO bytes to delete for a draft that
   * never fetched anything. In `dryRun` mode this is a preview count; no row
   * is written.
   */
  autoAbandoned: number;
  artifacts: ArtifactCleanupResultItem[];
}

/**
 * DS-LAKE-009B: reclaims MinIO bytes for intermediate (non-FINAL) artifacts
 * once they are no longer needed for recovery, audit or retry. Never touches
 * the FINAL artifact or the DatasetVersion registry (out of scope by
 * acceptance criterion), and never deletes a DatasetArtifact row — only
 * `run()`'s Python call removes bytes; the row survives with
 * `objectReclaimedAt` stamped (decisions.cleanup_scope / T09).
 *
 * DS-LAKE-014: registers a periodic sweep (`onModuleInit` starts a
 * `setInterval(...).unref()`, matching the `.unref()`/swallow-errors idiom
 * `PreprocessingJobService.scheduleStragglerSweep` already establishes for a
 * one-shot timer, and the boot-hook idiom its own `onModuleInit` and
 * `LoaderJobService`/`TrainningContainerAuthorizedService` establish for
 * lifecycle hooks) that calls `run({ dryRun: false })` on its own, closing
 * the gap this class used to document as deliberate: nothing called `run()`
 * except the admin endpoint. `CLEANUP_SWEEP_INTERVAL_MS <= 0` disables the
 * sweep entirely — the admin endpoint keeps working unchanged either way.
 *
 * SINGLE REPLICA ONLY, same assumption `PreprocessingJobService` already
 * documents for its own boot sweep: with two replicas both running an
 * interval, cleanup work is duplicated, not corrupted — overlap is safe by
 * construction (candidates are queried `WHERE objectReclaimedAt IS NULL`,
 * and `delete_prefix` on an absent prefix returns 0 rather than erroring,
 * DS-LAKE-009B-T06) — but wasteful. No lock is added because nothing here
 * requires more than that.
 */
@Injectable()
export class ArtifactCleanupAdminService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(ArtifactCleanupAdminService.name);

  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    const intervalMs = env.CLEANUP_SWEEP_INTERVAL_MS;
    if (intervalMs <= 0) {
      this.logger.log(
        'Cleanup sweep disabled (CLEANUP_SWEEP_INTERVAL_MS <= 0) — the ' +
          'admin endpoint remains the only trigger.',
      );
      return;
    }
    this.sweepTimer = setInterval(() => {
      void this.sweep();
    }, intervalMs);
    this.sweepTimer.unref();
    this.logger.log(`Cleanup sweep scheduled every ${intervalMs}ms.`);
  }

  onApplicationShutdown(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  /**
   * DS-LAKE-014-T03: the interval timer's own entrypoint — never called by
   * the admin endpoint, which calls `run()` directly. A failure is logged
   * and swallowed here: a failed sweep must never crash the process, and
   * everything it would have reclaimed stays eligible for the next tick
   * (`objectReclaimedAt IS NULL` is what makes that true).
   */
  private async sweep(): Promise<void> {
    try {
      await this.run({ dryRun: false, trigger: 'interval' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Cleanup sweep failed, will retry next tick: ${message}`,
      );
    }
  }

  async run(options: {
    dryRun: boolean;
    /** DS-LAKE-014-T05/V03: threaded into the summary log line so a sweep
     * that fired on its own is distinguishable from an admin-triggered run
     * without depending on per-request access logging, which this stack
     * does not enable by default. Defaults to 'admin' — the controller does
     * not need to pass it. */
    trigger?: 'admin' | 'interval';
  }): Promise<ArtifactCleanupRunResult> {
    const trigger = options.trigger ?? 'admin';
    const { protectedArtifactIds, objectKeySharedWithFinalIds } =
      await this.computeProtectedArtifactIds();

    const candidates = await this.prisma.datasetArtifact.findMany({
      where: { type: { not: 'FINAL' }, objectReclaimedAt: null },
      select: {
        id: true,
        type: true,
        draftId: true,
        objectKey: true,
        sizeBytes: true,
      },
    });
    const sizeByArtifactId = new Map(
      candidates.map((artifact) => [artifact.id, artifact.sizeBytes]),
    );

    const draftIds = [
      ...new Set(
        candidates
          .map((artifact) => artifact.draftId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const draftRows = draftIds.length
      ? await this.prisma.datasetDraft.findMany({
          where: { id: { in: draftIds } },
          select: { id: true, status: true, updatedAt: true },
        })
      : [];
    const drafts = new Map<string, CleanupDraftInfo>(
      draftRows.map((draft) => [
        draft.id,
        { status: draft.status, updatedAt: draft.updatedAt },
      ]),
    );

    // T03: an artifact referenced by an active (QUEUED/RUNNING) job is
    // refused regardless of what the age/lineage predicate says — a job
    // mid-flight can still read its sourceArtifact or be about to write its
    // resultArtifact. SUCCEEDED/FAILED/CANCELED jobs impose no restriction;
    // their reference is historical, not a live read.
    const activeJobs = await this.prisma.preprocessingJob.findMany({
      where: { status: { in: ['QUEUED', 'RUNNING'] } },
      select: { sourceArtifactId: true, resultArtifactId: true },
    });
    const activelyReferencedIds = new Set<string>();
    for (const job of activeJobs) {
      if (job.sourceArtifactId) activelyReferencedIds.add(job.sourceArtifactId);
      if (job.resultArtifactId) activelyReferencedIds.add(job.resultArtifactId);
    }

    const report = reportCleanupEligibility(
      candidates,
      protectedArtifactIds,
      drafts,
      {
        draftRecoveryHours: env.CLEANUP_DRAFT_RECOVERY_HOURS,
        intermediateRetentionHours: env.CLEANUP_INTERMEDIATE_RETENTION_HOURS,
        activeIdleHours: env.CLEANUP_ACTIVE_IDLE_HOURS,
      },
      new Date(),
      objectKeySharedWithFinalIds,
    );
    const eligibleIds = new Set(report.eligible);

    let activeJobSkipped = 0;
    const eligibleArtifacts = candidates.filter((artifact) => {
      if (!eligibleIds.has(artifact.id)) return false;
      if (activelyReferencedIds.has(artifact.id)) {
        activeJobSkipped += 1;
        return false;
      }
      return true;
    });

    const results: ArtifactCleanupResultItem[] = [];
    let reclaimed = 0;
    let failed = 0;
    let bytesReclaimed = 0n;

    for (const artifact of eligibleArtifacts) {
      if (options.dryRun) {
        results.push({
          id: artifact.id,
          objectKey: artifact.objectKey,
          type: artifact.type,
        });
        continue;
      }

      // Reclaim objects FIRST, stamp the row SECOND — never the reverse. A
      // stamp-then-fail would leave bytes orphaned with no row saying so.
      //
      // The reverse order has its own hazard: Python succeeds (bytes are
      // GONE) and the stamp write then fails or the process dies. A bare
      // "leave it for next run" is not enough here, because the next run's
      // query (`objectReclaimedAt: null`) would re-select this artifact,
      // call Python again, get `deleted: 0` (T06's idempotency), and THEN
      // stamp — technically convergent, but every reader in between
      // (listDraftRowsService, /metadata, /rows) sees a row that claims
      // its bytes exist when they do not, surfacing as an unexplained 422.
      // So: once Python has confirmed the delete, the stamp is retried
      // once immediately rather than deferred to "eventually, next run".
      let response: { prefix: string; deleted: number };
      try {
        response = PythonArtifactReclaimSchema.parse(
          await postToPython(
            '/v1/preprocess/artifacts/reclaim',
            { object_key: artifact.objectKey },
            PYTHON_TIMEOUT.metadata,
          ),
        );
      } catch (err) {
        failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Could not reclaim artifact ${artifact.id} (${artifact.objectKey}): ${message}`,
        );
        results.push({
          id: artifact.id,
          objectKey: artifact.objectKey,
          type: artifact.type,
          error: message,
        });
        continue;
      }

      // Python has confirmed the bytes are gone — count them toward this
      // run's total regardless of what happens to the stamp write next.
      bytesReclaimed += sizeByArtifactId.get(artifact.id) ?? 0n;

      try {
        await this.stampReclaimed(artifact.id);
        reclaimed += 1;
        results.push({
          id: artifact.id,
          objectKey: artifact.objectKey,
          type: artifact.type,
          deletedObjects: response.deleted,
        });
      } catch (err) {
        failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Reclaimed artifact ${artifact.id} (${artifact.objectKey}) in ` +
            `MinIO but could NOT stamp objectReclaimedAt after a retry — ` +
            `the row now understates reality until the next run's retry ` +
            `converges it (idempotent delete, T06): ${message}`,
        );
        results.push({
          id: artifact.id,
          objectKey: artifact.objectKey,
          type: artifact.type,
          deletedObjects: response.deleted,
          error: message,
        });
      }
    }

    const autoAbandoned = await this.autoAbandonEmptyActiveDrafts(
      options.dryRun,
    );

    const skipped: ArtifactCleanupSkipCounts = {
      ...report.skipped,
      active_job: activeJobSkipped,
    };

    // DS-LAKE-014-T05: logged on EVERY run, success or not, so a sweep that
    // reclaimed nothing is distinguishable in the logs from a sweep that
    // never ran. `trigger` is what V03 asserts on to prove the interval
    // fired on its own without an HTTP call.
    this.logger.log(
      `Cleanup sweep (trigger=${trigger}, dryRun=${options.dryRun}): ` +
        `examined ${candidates.length}, reclaimed ${reclaimed} ` +
        `(${bytesReclaimed.toString()} bytes), failed ${failed}, ` +
        `skipped ${JSON.stringify(skipped)}, auto-abandoned ${autoAbandoned} ` +
        `empty draft(s).`,
    );

    return {
      dryRun: options.dryRun,
      scanned: candidates.length,
      eligible: eligibleArtifacts.length,
      reclaimed,
      failed,
      bytesReclaimed: bytesReclaimed.toString(),
      skipped,
      autoAbandoned,
      artifacts: results,
    };
  }

  /**
   * Writes `objectReclaimedAt`, retrying once on failure. Only ever called
   * AFTER Python has confirmed the objects are gone — see the doc comment
   * at its call site in `run()` for why a single immediate retry matters
   * here specifically, unlike every other write in this service.
   */
  private async stampReclaimed(artifactId: string): Promise<void> {
    try {
      await this.prisma.datasetArtifact.update({
        where: { id: artifactId },
        data: { objectReclaimedAt: new Date() },
      });
    } catch {
      await this.prisma.datasetArtifact.update({
        where: { id: artifactId },
        data: { objectReclaimedAt: new Date() },
      });
    }
  }

  /**
   * DS-LAKE-014-T02: an ACTIVE draft owning ZERO live artifacts (nothing was
   * ever fetched, or everything it fetched was already reclaimed) can never
   * surface from `reportCleanupEligibility` — that function is artifact-
   * keyed, so a draft with no candidate rows never gets visited. There are
   * also no MinIO bytes to reclaim for such a draft. "Reclaimed" for this
   * case is therefore a DRAFT-LEVEL status transition to ABANDONED (no row
   * deleted, no object touched, per decisions.cleanup_scope) — it rejoins
   * `CLEANUP_DRAFT_RECOVERY_HOURS` like any other abandoned draft from here.
   *
   * Called AFTER the artifact loop above on purpose: an ACTIVE draft whose
   * one artifact just crossed `activeIdleHours` and got reclaimed in THIS
   * SAME run() call becomes "zero live artifacts" by the time this method's
   * query runs — live-observed (DS-LAKE-014-V02) — so it can auto-abandon in
   * the very same tick that reclaimed it, not just on a later, independent
   * pass. This is a second-order consequence of the artifact pass, not a
   * separate empty-draft check catching up; it violates no acceptance
   * criterion (the idle tier, not the empty tier, did the reclaiming) but is
   * worth knowing before debugging a draft that abandoned "without" an
   * empty-draft cause.
   *
   * `dryRun` previews via `count` rather than writing, matching `run()`'s
   * own dry-run contract for the artifact loop above.
   */
  private async autoAbandonEmptyActiveDrafts(dryRun: boolean): Promise<number> {
    const cutoff = new Date(
      Date.now() - env.CLEANUP_ACTIVE_EMPTY_MINUTES * 60_000,
    );
    const where = {
      status: 'ACTIVE' as const,
      updatedAt: { lt: cutoff },
      artifacts: { none: { objectReclaimedAt: null } },
    };

    if (dryRun) {
      return this.prisma.datasetDraft.count({ where });
    }

    const { count } = await this.prisma.datasetDraft.updateMany({
      where,
      data: { status: 'ABANDONED' },
    });
    return count;
  }

  /**
   * T08's reachability set: every artifact id on the parentArtifactId chain
   * of any non-ARCHIVED DatasetVersion's FINAL artifact. Walks via Prisma
   * directly, mirroring the exact pattern `saveDraftAsDatasetService` already
   * uses to build its lineage snapshot (dataset-draft.authorized.service.ts)
   * — chains are shallow (BRONZE→SILVER→GOLD→FINAL, at most 4 deep), so this
   * is a handful of point lookups per live version, not a full-table scan.
   *
   * Also returns `objectKeySharedWithFinalIds` — for each live version, the
   * ONE artifact directly promoted to its FINAL (the first hop of the same
   * walk, before `cursor` moves past it). That artifact's `objectKey` is
   * FINAL's own objectKey too (`promoteDraftArtifactToFinalService` never
   * copies bytes), so it needs its own type-agnostic hard pin in
   * `selectCleanupEligibleArtifacts` — see that module's doc comment for the
   * incident this fixes.
   */
  private async computeProtectedArtifactIds(): Promise<{
    protectedArtifactIds: Set<string>;
    objectKeySharedWithFinalIds: Set<string>;
  }> {
    const liveVersions = await this.prisma.datasetVersion.findMany({
      where: { status: { not: 'ARCHIVED' }, artifactId: { not: null } },
      select: { artifactId: true },
    });

    const protectedIds = new Set<string>();
    const objectKeySharedWithFinalIds = new Set<string>();
    for (const version of liveVersions) {
      let cursor = version.artifactId;
      let isDirectFinalParent = true;
      while (cursor && !protectedIds.has(cursor)) {
        protectedIds.add(cursor);
        const parent = await this.prisma.datasetArtifact.findUnique({
          where: { id: cursor },
          select: { parentArtifactId: true },
        });
        cursor = parent?.parentArtifactId ?? null;
        // First hop from FINAL (version.artifactId) lands on the artifact
        // FINAL was promoted from — exactly the one sharing FINAL's bytes.
        // Every subsequent hop is a genuine ancestor, re-derivable as usual.
        if (isDirectFinalParent && cursor) {
          objectKeySharedWithFinalIds.add(cursor);
        }
        isDirectFinalParent = false;
      }
    }
    return { protectedArtifactIds: protectedIds, objectKeySharedWithFinalIds };
  }
}
