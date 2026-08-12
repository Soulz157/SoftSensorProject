import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService, PrismaTypes } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import {
  postBinaryToPython,
  postToPython,
  PYTHON_TIMEOUT,
} from '@/lib/python-client';
import { artifactKey } from '@/lib/artifact-keys';
import { buildSourceBlock } from '@/lib/source-block';
import { PreprocessingJobService } from './preprocessing-job.service';
import {
  ArtifactStatsSchema,
  PythonColumnStatsSchema,
  PythonMetadataSchema,
  PythonPreviewSchema,
  PythonRowsSchema,
  PythonTagCatalogSchema,
  type CreateRawVersionDto,
  type ListRowsDto,
  type PreviewVersionDto,
  type StartCleanJobDto,
  type TagCatalogDto,
} from './dto/dataset-version.authorized.dto';

/**
 * Dataset versions and preprocessing jobs.
 *
 * Access control differs DELIBERATELY from the Dataset CRUD routes next door.
 * Those filter on `createdById === userId` (`dataset.authorized.service.ts:82`,
 * :128, :161); this service uses owner-or-member workspace access. Versions are
 * workspace artifacts — scoping them to their creator would make a teammate's
 * cleaned data invisible inside a workspace they belong to. The asymmetry on
 * the CRUD routes is a separate pre-existing issue and is not propagated here.
 *
 * The ADMIN bypass IS shared with the CRUD routes, though — see
 * assertDatasetAccess. That one has to match, or an admin can create a dataset
 * somewhere they cannot then read it.
 *
 * Rows never pass through this service. It sends keys and parameters to the
 * connector and stores what comes back; frames go straight from the source into
 * object storage without a detour through the API server.
 */
@Injectable()
export class DatasetVersionAuthorizedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: PreprocessingJobService,
  ) {}

  // ── access ───────────────────────────────────────────────────────────────

  /**
   * Owner-or-member on the dataset's workspace. 404 rather than 403 throughout:
   * confirming to an unauthorised caller that a dataset exists is itself a leak.
   */
  private async assertDatasetAccess(datasetId: string, user: Auth.UserPayload) {
    // ADMIN bypasses membership, exactly as dataset.authorized.service.ts:70
    // does for the CRUD routes. The two rules MUST agree: they did not until
    // now, so an ADMIN who is not a member of a workspace could create a
    // dataset there (allowed by the CRUD rule) and then never store its rows
    // (404 by this one) — a dataset permanently stuck without an artifact,
    // seen as "Dataset saved, but its rows could not be stored: Dataset not
    // found".
    const isAdmin = user.role === 'ADMIN';
    const dataset = await this.prisma.dataset.findFirst({
      where: {
        id: datasetId,
        workspace: {
          deletedAt: null,
          ...(isAdmin
            ? {}
            : {
                OR: [
                  { ownerId: user.id },
                  { members: { some: { userId: user.id } } },
                ],
              }),
        },
      },
    });
    if (!dataset) {
      throw new AppException({
        statusCode: 404,
        message: 'Dataset not found',
        type: 'ERROR',
      });
    }
    return dataset;
  }

  // `findVersion` (DatasetVersion-only lookup) was removed in
  // DS-LAKE-005B-A-T04: its one caller, `previewService`, switched to
  // `findArtifactSource` (version-first, artifact-fallback) to fix a 404 on
  // every artifact-first dataset — see that method's docstring.

  /**
   * Resolve an id that may be EITHER a DatasetVersion or a DatasetArtifact.
   *
   * `GET /:id/versions/:versionId/rows` is kept as a shim so datasets created
   * before DS-LAKE-004 keep working and `models/create` needs no edits — the
   * refactor's own checklist requires "Model Training still works without
   * modification".
   *
   * The lookup order is versions first, then artifacts. That is not arbitrary:
   * DS-LAKE-002's backfill REUSED each version's uuid as its artifact id, so
   * for a legacy row both tables answer and they point at the same objectKey.
   * Versions first keeps the legacy path byte-identical to its old behaviour.
   *
   * DS-LAKE-009-T07: DatasetVersion no longer OWNS objectKey directly (the
   * registry reshape moved storage ownership onto DatasetArtifact) — but the
   * paragraph above still holds, because the backfill's shared-uuid design
   * means the artifact lookup below answers IDENTICALLY for every legacy
   * row that the version lookup used to. Verified directly against this
   * repo's dev DB, not assumed: the one pre-reshape row's artifact twin
   * carries the exact same objectKey the version column held before this
   * migration dropped it. The version-first branch is therefore now
   * REDUNDANT rather than merely broken, and is removed below rather than
   * patched to chase objectKey through `version.artifact` — there is
   * nothing the version branch would answer that the artifact branch does
   * not already answer the same way.
   */
  /**
   * Decide which pointer a job row should carry for a given source id.
   *
   * Artifacts are checked FIRST here, unlike `findArtifactSource`, and the
   * difference is deliberate. That helper answers "where are the bytes", where
   * a legacy row must keep its historical answer. This one answers "what should
   * this job read", and a new job should prefer the artifact ledger — the
   * backfill gave legacy rows an artifact twin, so preferring it means the
   * SILVER result gets a real `parentArtifactId` instead of a null one.
   */
  private async resolveJobSource(
    datasetId: string,
    id: string,
  ): Promise<{ artifactId: string | null; versionId: string | null }> {
    const artifact = await this.prisma.datasetArtifact.findFirst({
      where: { id, datasetId },
      select: { id: true },
    });
    if (artifact) return { artifactId: artifact.id, versionId: null };

    const version = await this.prisma.datasetVersion.findFirst({
      where: { id, datasetId },
      select: { id: true },
    });
    if (version) return { artifactId: null, versionId: version.id };

    throw new AppException({
      statusCode: 404,
      message: 'Dataset version not found',
      type: 'ERROR',
    });
  }

  private async findArtifactSource(
    datasetId: string,
    id: string,
  ): Promise<{ objectKey: string }> {
    const artifact = await this.prisma.datasetArtifact.findFirst({
      where: { id, datasetId },
      select: { objectKey: true },
    });
    if (artifact) return artifact;

    throw new AppException({
      statusCode: 404,
      message: 'Dataset version not found',
      type: 'ERROR',
    });
  }

  // ── versions ─────────────────────────────────────────────────────────────

  /**
   * DS-LAKE-009-T07: `parentVersionId`/`stage`/`operations` no longer exist
   * on DatasetVersion (the registry reshape — DS-LAKE-009-T06). Replaced
   * with the fields the reshaped registry row actually carries:
   * `semanticVersion`/`artifactId`/`status`/`qualityScore`/`featureCount`.
   * `lineage` (the frozen chain snapshot) is deliberately NOT included here
   * — same reasoning as `column_stats.json` living beside the data rather
   * than inline in a list response: a per-version detail read is the right
   * place for it, not a list of every version at once.
   *
   * `sizeBytes` is cast through `Number(...)`: Prisma's BigInt does not
   * `JSON.stringify` (throws `TypeError`), and this is a live GET endpoint
   * — the widen to BigInt (T06) exists for the COLUMN's own ceiling, not to
   * change what the wire format sends.
   *
   * ONE consumer of the OLD shape was checked, not assumed clean:
   * `use-dataset-version-rows.ts:215` filters `v.stage === 'RAW'`, but only
   * reaches that branch when `dataset.currentArtifactId` is null AND
   * `dataset.currentVersionId` is set — a combination the DS-LAKE-002
   * backfill's own `UPDATE ... SET currentArtifactId = currentVersionId`
   * makes unreachable for every dataset in this DB today. Even if reached,
   * a missing `stage` degrades to that same file's own existing "no RAW
   * version found" fallback (`raw?.id ?? dataset.currentVersionId`), not a
   * crash — so this response shape change is not silently risking that path.
   */
  async listVersionsService(user: Auth.UserPayload, datasetId: string) {
    await this.assertDatasetAccess(datasetId, user);
    const items = await this.prisma.datasetVersion.findMany({
      where: { datasetId },
      orderBy: { versionNumber: 'asc' },
      include: { createdBy: { select: { firstName: true, lastName: true } } },
    });

    return {
      statusCode: 200,
      message: 'Dataset versions fetched successfully',
      type: 'SUCCESS' as const,
      data: items.map((item) => ({
        id: item.id,
        datasetId: item.datasetId,
        semanticVersion: item.semanticVersion,
        artifactId: item.artifactId,
        versionNumber: item.versionNumber,
        status: item.status,
        qualityScore: item.qualityScore,
        rowCount: item.rowCount,
        columnCount: item.columnCount,
        featureCount: item.featureCount,
        missingPct: item.missingPct,
        sizeBytes: Number(item.sizeBytes),
        durationMs: item.durationMs,
        createdAt: item.createdAt.toISOString(),
        createdBy:
          [item.createdBy.firstName, item.createdBy.lastName]
            .filter(Boolean)
            .join(' ') || 'Unknown',
      })),
    };
  }

  /**
   * Materialize V1 (raw) — fetch from the source and write the first artifact.
   *
   * Runs INLINE rather than as a job: a fetch is a single connector call with
   * no intermediate steps to report, so a job row would add a state machine
   * without adding information. Bounded by `PYTHON_TIMEOUT.preprocess`.
   */
  async createRawVersionService(
    user: Auth.UserPayload,
    datasetId: string,
    dto: CreateRawVersionDto,
  ) {
    const dataset = await this.assertDatasetAccess(datasetId, user);

    // Restricted to the dataset's OWN sources. Access is asserted on the
    // dataset, but the secret decrypted in buildSourceBlock belongs to the
    // DataSource — so an unconstrained lookup would let any caller holding one
    // dataset name an arbitrary source id and have the server connect with that
    // source's credentials. DataSource carries no workspaceId, so the recipe's
    // own source list is both the tightest scope available and the correct one:
    // materialising replays that recipe, nothing else.
    const source = dataset.sourceIds.includes(dto.sourceId)
      ? await this.prisma.dataSource.findFirst({ where: { id: dto.sourceId } })
      : null;
    if (!source) {
      throw new AppException({
        statusCode: 404,
        message: 'Data source not found',
        type: 'ERROR',
      });
    }

    const artifactId = randomUUID();
    // One run groups the whole BRONZE -> SILVER -> GOLD -> FINAL chain. A fetch
    // starts a new chain, so it mints one unless the caller is continuing an
    // existing run.
    const runId = dto.runId ?? randomUUID();
    const startedAt = Date.now();

    const stats = ArtifactStatsSchema.parse(
      await postToPython(
        '/v1/preprocess/materialize',
        {
          target_key: artifactKey(datasetId, artifactId),
          ...buildSourceBlock(source, dto),
        },
        PYTHON_TIMEOUT.preprocess,
      ),
    );

    // Artifact row and the dataset's pointer to it, together: a committed
    // artifact the dataset does not point at is invisible to every read path.
    //
    // NO DatasetVersion is created here, and `currentVersionId` is not touched.
    // That is the whole point of DS-LAKE-004: fetching raw data is a pipeline
    // stage, not a save. A Dataset Version is created only by Save Dataset
    // (DS-LAKE-009).
    const artifact = await this.prisma.$transaction(async (tx) => {
      const created = await tx.datasetArtifact.create({
        data: {
          id: artifactId,
          datasetId,
          runId,
          // A bronze artifact is a lineage ROOT — it comes from the source
          // system, not from another artifact.
          parentArtifactId: null,
          type: 'BRONZE',
          objectKey: stats.object_key,
          checksum: stats.checksum,
          rowCount: stats.row_count,
          columnCount: stats.column_count,
          missingPct: stats.missing_pct,
          sizeBytes: BigInt(stats.size_bytes),
          // A bronze artifact is produced by a FETCH, not by operations.
          operations: [],
          columnStatsKey: stats.column_stats_key,
          durationMs: Date.now() - startedAt,
          createdById: user.id,
        },
      });
      await tx.dataset.update({
        where: { id: datasetId },
        data: { currentArtifactId: created.id },
      });
      return created;
    });

    return {
      statusCode: 201,
      message: 'Raw dataset artifact created successfully',
      type: 'SUCCESS' as const,
      data: {
        id: artifact.id,
        runId: artifact.runId,
        type: artifact.type,
        checksum: artifact.checksum,
        rowCount: artifact.rowCount,
        columnCount: artifact.columnCount,
        missingPct: artifact.missingPct,
      },
    };
  }

  // ── rows + preview ───────────────────────────────────────────────────────

  async listRowsService(
    user: Auth.UserPayload,
    datasetId: string,
    versionId: string,
    query: ListRowsDto,
  ) {
    await this.assertDatasetAccess(datasetId, user);
    // Accepts a version id (legacy) or an artifact id (DS-LAKE-004 onwards).
    const source = await this.findArtifactSource(datasetId, versionId);

    const pythonBody = {
      source_key: source.objectKey,
      offset: query.offset,
      limit: query.limit,
      ...(query.tags && { tags: query.tags }),
      ...(query.startTime && { start_time: query.startTime }),
      ...(query.endTime && { end_time: query.endTime }),
    };

    if (query.format === 'arrow') {
      // DS-LAKE-005B-A-T05 (rescoped: server-side transport only). No Zod
      // parse here — there is nothing to validate an opaque Arrow byte
      // buffer against; PythonRowsSchema's guarantee applies to the json
      // branch below only. The controller passes these bytes straight to
      // the browser, undecoded.
      const binary = await postBinaryToPython(
        '/v1/preprocess/rows',
        { ...pythonBody, format: 'arrow' },
        PYTHON_TIMEOUT.fetch,
      );
      return { format: 'arrow' as const, ...binary };
    }

    const page = PythonRowsSchema.parse(
      await postToPython(
        '/v1/preprocess/rows',
        pythonBody,
        PYTHON_TIMEOUT.fetch,
      ),
    );

    return {
      format: 'json' as const,
      statusCode: 200,
      message: 'Rows fetched successfully',
      type: 'SUCCESS' as const,
      data: {
        totalRowCount: page.total_row_count,
        offset: page.offset,
        tags: page.tags,
        filtered: page.filtered,
        startTime: page.start_time,
        endTime: page.end_time,
        rows: page.rows,
      },
    };
  }

  // ── metadata ─────────────────────────────────────────────────────────────

  /**
   * Artifact metadata for a bounded viewport, not a row payload
   * (DS-LAKE-005B-A-T01). Canonical-artifact-id only — unlike `listRowsService`
   * this has no legacy `DatasetVersion` compat shim, since nothing existing
   * ever called it before this endpoint existed.
   *
   * Mirrors `DatasetDraftAuthorizedService.getDraftArtifactMetadataService`.
   */
  async getArtifactMetadataService(
    user: Auth.UserPayload,
    datasetId: string,
    artifactId: string,
  ) {
    await this.assertDatasetAccess(datasetId, user);
    const artifact = await this.prisma.datasetArtifact.findFirst({
      where: { id: artifactId, datasetId },
    });
    if (!artifact) {
      throw new AppException({
        statusCode: 404,
        message: 'Dataset artifact not found',
        type: 'ERROR',
      });
    }

    const meta = PythonMetadataSchema.parse(
      await postToPython(
        '/v1/preprocess/metadata',
        { source_key: artifact.objectKey },
        PYTHON_TIMEOUT.metadata,
      ),
    );

    return {
      statusCode: 200,
      message: 'Artifact metadata fetched successfully',
      type: 'SUCCESS' as const,
      data: {
        id: artifact.id,
        runId: artifact.runId,
        type: artifact.type,
        parentArtifactId: artifact.parentArtifactId,
        checksum: artifact.checksum,
        rowCount: artifact.rowCount,
        tagCount: artifact.columnCount,
        // Measured from the same schema read as `tags`, not `tagCount * 2` —
        // a derived number could disagree with `tags` on a legacy artifact.
        columnCount: meta.column_count,
        missingPct: artifact.missingPct,
        // BigInt is not JSON-serialisable; Fastify has no BigInt replacer
        // registered (checked: no setSerializerCompiler/toJSON patch exists).
        sizeBytes: artifact.sizeBytes.toString(),
        tags: meta.tags,
        startTime: meta.start_time,
        endTime: meta.end_time,
        createdAt: artifact.createdAt.toISOString(),
      },
    };
  }

  /**
   * Paginated, searchable tag catalog (DS-LAKE-005B-A-T03). Canonical
   * artifact-id only, mirroring `getArtifactMetadataService` — no legacy
   * `DatasetVersion` compat shim, since nothing existing ever called this.
   */
  async getArtifactTagCatalogService(
    user: Auth.UserPayload,
    datasetId: string,
    artifactId: string,
    query: TagCatalogDto,
  ) {
    await this.assertDatasetAccess(datasetId, user);
    const artifact = await this.prisma.datasetArtifact.findFirst({
      where: { id: artifactId, datasetId },
      select: { objectKey: true },
    });
    if (!artifact) {
      throw new AppException({
        statusCode: 404,
        message: 'Dataset artifact not found',
        type: 'ERROR',
      });
    }

    const page = PythonTagCatalogSchema.parse(
      await postToPython(
        '/v1/preprocess/tags',
        {
          source_key: artifact.objectKey,
          offset: query.offset,
          limit: query.limit,
          ...(query.search && { search: query.search }),
        },
        PYTHON_TIMEOUT.metadata,
      ),
    );

    return {
      statusCode: 200,
      message: 'Tag catalog fetched successfully',
      type: 'SUCCESS' as const,
      data: {
        totalCount: page.total_count,
        offset: page.offset,
        search: page.search,
        tags: page.tags,
      },
    };
  }

  /**
   * Per-tag aggregate stats sidecar (DS-LAKE-005B-A-T07). Canonical
   * artifact-id only, mirroring `getArtifactMetadataService`.
   *
   * Checks `columnStatsKey` BEFORE calling Python: an artifact written
   * before this task (or by a write path this task did not reach) has no
   * sidecar, and that is knowable from Postgres alone — short-circuiting
   * here gives a clearer 404 than round-tripping to Python only to get its
   * own 422 for the same missing object.
   */
  async getArtifactColumnStatsService(
    user: Auth.UserPayload,
    datasetId: string,
    artifactId: string,
  ) {
    await this.assertDatasetAccess(datasetId, user);
    const artifact = await this.prisma.datasetArtifact.findFirst({
      where: { id: artifactId, datasetId },
      select: { objectKey: true, columnStatsKey: true },
    });
    if (!artifact) {
      throw new AppException({
        statusCode: 404,
        message: 'Dataset artifact not found',
        type: 'ERROR',
      });
    }
    if (!artifact.columnStatsKey) {
      throw new AppException({
        statusCode: 404,
        message:
          'No column statistics available for this artifact (written before DS-LAKE-005B-A-T07, or a write path that did not produce one).',
        type: 'ERROR',
      });
    }

    const result = PythonColumnStatsSchema.parse(
      await postToPython(
        '/v1/preprocess/column-stats',
        { source_key: artifact.objectKey },
        PYTHON_TIMEOUT.metadata,
      ),
    );

    return {
      statusCode: 200,
      message: 'Column statistics fetched successfully',
      type: 'SUCCESS' as const,
      data: {
        columnStatsKey: result.column_stats_key,
        stats: result.stats,
      },
    };
  }

  /**
   * Preview writes nothing — no job, no version row, no object.
   *
   * Resolves via `findArtifactSource` (version-first, artifact-fallback),
   * NOT `findVersion` — that was this method's bug before DS-LAKE-005B-A-T04:
   * `findVersion` only ever queries `DatasetVersion`, so every artifact-first
   * dataset (DS-LAKE-004 onward, no `DatasetVersion` row until Save) 404'd
   * here even though `listRowsService` next door already resolved the same
   * ids correctly. Bounding by tags/time only matters if the endpoint is
   * reachable in the first place.
   */
  async previewService(
    user: Auth.UserPayload,
    datasetId: string,
    versionId: string,
    dto: PreviewVersionDto,
  ) {
    await this.assertDatasetAccess(datasetId, user);
    const source = await this.findArtifactSource(datasetId, versionId);

    const preview = PythonPreviewSchema.parse(
      await postToPython(
        '/v1/preprocess/preview',
        {
          source_key: source.objectKey,
          operations: dto.operations,
          precision: dto.precision,
          ...(dto.sampleRows && { sample_rows: dto.sampleRows }),
          ...(dto.previewRows && { preview_rows: dto.previewRows }),
          ...(dto.tags && { tags: dto.tags }),
          ...(dto.startTime && { start_time: dto.startTime }),
          ...(dto.endTime && { end_time: dto.endTime }),
          // DS-LAKE-005B-A-T06: bypasses the sample_rows head cut on the
          // Python side, so the request can take longer than a plain
          // preview — still well inside PYTHON_TIMEOUT.metadata.
          ...(dto.maxPoints && { max_points: dto.maxPoints }),
        },
        PYTHON_TIMEOUT.metadata,
      ),
    );

    return {
      statusCode: 200,
      message: 'Preview generated successfully',
      type: 'SUCCESS' as const,
      data: preview,
    };
  }

  // ── jobs ─────────────────────────────────────────────────────────────────

  /**
   * Queue a cleaning job and return immediately. The HTTP request must not wait
   * on the pipeline (CLAUDE.md §5) — the controller answers 202 and the client
   * polls the job for progress.
   */
  async startCleanJobService(
    user: Auth.UserPayload,
    datasetId: string,
    versionId: string,
    dto: StartCleanJobDto,
  ) {
    await this.assertDatasetAccess(datasetId, user);
    // DS-LAKE-005: the source may be an artifact (normal) or a legacy version.
    // Resolving which one it is decides which pointer the job row carries —
    // setting the wrong one strands the job with "no source artifact".
    const source = await this.resolveJobSource(datasetId, versionId);

    const job = await this.prisma.preprocessingJob.create({
      data: {
        datasetId,
        sourceArtifactId: source.artifactId,
        sourceVersionId: source.versionId,
        status: 'QUEUED',
        stage: 'CLEAN',
        totalSteps: dto.operations.length,
        // Precision travels WITH the operations: it is part of the recipe that
        // produced a version, and a replay without it rounds differently.
        operations: {
          operations: dto.operations,
          precision: dto.precision,
        },
        createdById: user.id,
      },
    });

    this.jobs.start(job.id);

    return {
      statusCode: 202,
      message: 'Cleaning job accepted',
      type: 'SUCCESS' as const,
      data: { jobId: job.id, status: job.status },
    };
  }

  async getJobService(
    user: Auth.UserPayload,
    datasetId: string,
    jobId: string,
  ) {
    await this.assertDatasetAccess(datasetId, user);
    const job = await this.prisma.preprocessingJob.findFirst({
      where: { id: jobId, datasetId },
    });
    if (!job) {
      throw new AppException({
        statusCode: 404,
        message: 'Job not found',
        type: 'ERROR',
      });
    }

    return {
      statusCode: 200,
      message: 'Job fetched successfully',
      type: 'SUCCESS' as const,
      data: {
        id: job.id,
        status: job.status,
        stage: job.stage,
        progress: job.progress,
        currentStep: job.currentStep,
        totalSteps: job.totalSteps,
        completedSteps: job.completedSteps,
        estimatedRemainingMs: job.estimatedRemainingMs,
        error: job.error,
        attempts: job.attempts,
        sourceVersionId: job.sourceVersionId,
        resultVersionId: job.resultVersionId,
        startedAt: job.startedAt?.toISOString() ?? null,
        finishedAt: job.finishedAt?.toISOString() ?? null,
      },
    };
  }

  async cancelJobService(
    user: Auth.UserPayload,
    datasetId: string,
    jobId: string,
  ) {
    await this.assertDatasetAccess(datasetId, user);
    const job = await this.prisma.preprocessingJob.findFirst({
      where: { id: jobId, datasetId },
    });
    if (!job) {
      throw new AppException({
        statusCode: 404,
        message: 'Job not found',
        type: 'ERROR',
      });
    }
    if (job.status !== 'RUNNING' && job.status !== 'QUEUED') {
      throw new AppException({
        statusCode: 409,
        message: `Job is already ${job.status.toLowerCase()} and cannot be canceled.`,
        type: 'ERROR',
      });
    }

    const aborted = this.jobs.cancel(jobId);
    if (!aborted) {
      // QUEUED but not yet started, or a leftover this process does not own.
      // Marked terminal directly so it cannot be polled forever.
      await this.prisma.preprocessingJob.update({
        where: { id: jobId },
        data: {
          status: 'CANCELED',
          error: 'Canceled before the job started.',
          finishedAt: new Date(),
        },
      });
    }

    return {
      statusCode: 200,
      message: 'Job canceled',
      type: 'SUCCESS' as const,
      data: { jobId, status: 'CANCELED' as const },
    };
  }

  /**
   * Retry creates a NEW job rather than resetting the old one.
   *
   * Two reasons, both load-bearing: the failed attempt stays on the record, and
   * the new run mints a fresh versionId. Reusing the old one risks colliding
   * with an orphan artifact the failed run already wrote to that immutable key.
   */
  async retryJobService(
    user: Auth.UserPayload,
    datasetId: string,
    jobId: string,
  ) {
    await this.assertDatasetAccess(datasetId, user);
    const previous = await this.prisma.preprocessingJob.findFirst({
      where: { id: jobId, datasetId },
    });
    if (!previous) {
      throw new AppException({
        statusCode: 404,
        message: 'Job not found',
        type: 'ERROR',
      });
    }
    if (previous.status !== 'FAILED' && previous.status !== 'CANCELED') {
      throw new AppException({
        statusCode: 409,
        message: 'Only a failed or canceled job can be retried.',
        type: 'ERROR',
      });
    }

    const job = await this.prisma.preprocessingJob.create({
      data: {
        datasetId,
        // Both pointers are carried forward, not just `sourceVersionId`: a
        // DS-LAKE-005 job normally resolves its source through the artifact
        // ledger, and dropping `sourceArtifactId` here left the retried job
        // with neither pointer set — `PreprocessingJobService.run()` refuses
        // to run one, so retry silently produced a job that could never
        // succeed.
        sourceArtifactId: previous.sourceArtifactId,
        sourceVersionId: previous.sourceVersionId,
        status: 'QUEUED',
        stage: previous.stage,
        totalSteps: previous.totalSteps,
        operations: previous.operations as PrismaTypes.InputJsonValue,
        // The runner increments on start, so the new row carries the previous
        // count forward rather than restarting at zero.
        attempts: previous.attempts,
        createdById: user.id,
      },
    });

    this.jobs.start(job.id);

    return {
      statusCode: 202,
      message: 'Retry accepted',
      type: 'SUCCESS' as const,
      data: { jobId: job.id, status: job.status, retryOf: previous.id },
    };
  }
}
