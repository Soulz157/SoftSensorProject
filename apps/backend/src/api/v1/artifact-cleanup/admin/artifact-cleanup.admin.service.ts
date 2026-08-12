import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@softsensor/prisma';
import { postToPython, PYTHON_TIMEOUT } from '@/lib/python-client';
import { env } from '@/config/env.config';
import {
  selectCleanupEligibleArtifacts,
  type CleanupDraftInfo,
} from '@/lib/artifact-cleanup-eligibility';
import { PythonArtifactReclaimSchema } from './dto/artifact-cleanup.admin.dto';

export interface ArtifactCleanupResultItem {
  id: string;
  objectKey: string;
  type: string;
  deletedObjects?: number;
  error?: string;
}

export interface ArtifactCleanupRunResult {
  dryRun: boolean;
  scanned: number;
  eligible: number;
  reclaimed: number;
  failed: number;
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
 * Deliberately NOT registered as a recurring job (no `setInterval` /
 * `OnModuleInit`). CLAUDE.md §3/§11 asks for the smallest solution and no
 * acceptance criterion here requires automatic recurrence — this is a plain,
 * admin-triggered operation today. `PreprocessingJobService`'s boot sweep is
 * the established convention if a recurring pass is wanted later.
 */
@Injectable()
export class ArtifactCleanupAdminService {
  private readonly logger = new Logger(ArtifactCleanupAdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  async run(options: { dryRun: boolean }): Promise<ArtifactCleanupRunResult> {
    const protectedArtifactIds = await this.computeProtectedArtifactIds();

    const candidates = await this.prisma.datasetArtifact.findMany({
      where: { type: { not: 'FINAL' }, objectReclaimedAt: null },
      select: {
        id: true,
        type: true,
        draftId: true,
        objectKey: true,
      },
    });

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

    const eligibleIds = new Set(
      selectCleanupEligibleArtifacts(candidates, protectedArtifactIds, drafts, {
        draftRecoveryHours: env.CLEANUP_DRAFT_RECOVERY_HOURS,
        intermediateRetentionHours: env.CLEANUP_INTERMEDIATE_RETENTION_HOURS,
      }),
    );
    const eligibleArtifacts = candidates.filter(
      (artifact) =>
        eligibleIds.has(artifact.id) && !activelyReferencedIds.has(artifact.id),
    );

    const results: ArtifactCleanupResultItem[] = [];
    let reclaimed = 0;
    let failed = 0;

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

    return {
      dryRun: options.dryRun,
      scanned: candidates.length,
      eligible: eligibleArtifacts.length,
      reclaimed,
      failed,
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
   * T08's reachability set: every artifact id on the parentArtifactId chain
   * of any non-ARCHIVED DatasetVersion's FINAL artifact. Walks via Prisma
   * directly, mirroring the exact pattern `saveDraftAsDatasetService` already
   * uses to build its lineage snapshot (dataset-draft.authorized.service.ts)
   * — chains are shallow (BRONZE→SILVER→GOLD→FINAL, at most 4 deep), so this
   * is a handful of point lookups per live version, not a full-table scan.
   */
  private async computeProtectedArtifactIds(): Promise<Set<string>> {
    const liveVersions = await this.prisma.datasetVersion.findMany({
      where: { status: { not: 'ARCHIVED' }, artifactId: { not: null } },
      select: { artifactId: true },
    });

    const protectedIds = new Set<string>();
    for (const version of liveVersions) {
      let cursor = version.artifactId;
      while (cursor && !protectedIds.has(cursor)) {
        protectedIds.add(cursor);
        const parent = await this.prisma.datasetArtifact.findUnique({
          where: { id: cursor },
          select: { parentArtifactId: true },
        });
        cursor = parent?.parentArtifactId ?? null;
      }
    }
    return protectedIds;
  }
}
