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
import { PreprocessingJobService } from '../../dataset-version/authorized/preprocessing-job.service';
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
} from '../../dataset-version/authorized/dto/dataset-version.authorized.dto';
import { type CreateDraftDto } from './dto/dataset-draft.authorized.dto';

/**
 * DatasetDraft — the wizard-time owner under the Draft-first architecture
 * (`feature_list.preprocessing.json` → `decisions.draft_first`, DS-LAKE-004B
 * / DS-LAKE-005).
 *
 * No `Dataset` row exists while this service is in play. Bronze and Silver
 * artifacts, and the jobs that produce them, hang off `draftId` instead of
 * `datasetId` — the same `PreprocessingJobService.run()`/`commit()` runner
 * already understands both (DS-LAKE-004B made it draft-aware), so nothing
 * about the job lifecycle changes here, only who owns the row.
 *
 * Mirrors `DatasetVersionAuthorizedService` deliberately closely: this is the
 * same pipeline, scoped to a draft instead of a saved dataset. Where the two
 * diverge is the access rule (workspace membership directly, since there is
 * no dataset to check membership through) and the object-storage scope
 * (`drafts/{draftId}` instead of `{datasetId}`, per `artifactKey`'s `scope`
 * parameter — already generic for this from DS-LAKE-004B).
 */
@Injectable()
export class DatasetDraftAuthorizedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: PreprocessingJobService,
  ) {}

  // ── access ───────────────────────────────────────────────────────────────

  private async assertWorkspaceAccess(
    workspaceId: string,
    user: Auth.UserPayload,
  ) {
    const isAdmin = user.role === 'ADMIN';
    const workspace = await this.prisma.workspace.findFirst({
      where: {
        id: workspaceId,
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
      select: { id: true },
    });
    if (!workspace) {
      throw new AppException({
        statusCode: 404,
        message: 'Workspace not found',
        type: 'ERROR',
      });
    }
  }

  /** Owner-or-member on the draft's workspace, matching `assertDatasetAccess`. */
  private async assertDraftAccess(draftId: string, user: Auth.UserPayload) {
    const isAdmin = user.role === 'ADMIN';
    const draft = await this.prisma.datasetDraft.findFirst({
      where: {
        id: draftId,
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
    if (!draft) {
      throw new AppException({
        statusCode: 404,
        message: 'Dataset draft not found',
        type: 'ERROR',
      });
    }
    return draft;
  }

  // ── draft lifecycle ──────────────────────────────────────────────────────

  async createDraftService(user: Auth.UserPayload, dto: CreateDraftDto) {
    await this.assertWorkspaceAccess(dto.workspaceId, user);
    const draft = await this.prisma.datasetDraft.create({
      data: {
        workspaceId: dto.workspaceId,
        sourceIds: dto.sourceIds,
        name: dto.name,
        createdById: user.id,
      },
    });

    return {
      statusCode: 201,
      message: 'Dataset draft created successfully',
      type: 'SUCCESS' as const,
      data: this.mapDraft(draft),
    };
  }

  async getDraftService(user: Auth.UserPayload, draftId: string) {
    const draft = await this.assertDraftAccess(draftId, user);
    return {
      statusCode: 200,
      message: 'Dataset draft fetched successfully',
      type: 'SUCCESS' as const,
      data: this.mapDraft(draft),
    };
  }

  /**
   * Abandon rather than delete: the artifacts and jobs the draft owns stay in
   * MinIO and Postgres (immutable, per the artifact contract) — only the
   * draft's own status changes, so a stale wizard tab that keeps polling gets
   * an honest ABANDONED rather than a 404 for a row that vanished under it.
   */
  async abandonDraftService(user: Auth.UserPayload, draftId: string) {
    await this.assertDraftAccess(draftId, user);
    const draft = await this.prisma.datasetDraft.update({
      where: { id: draftId },
      data: { status: 'ABANDONED' },
    });
    return {
      statusCode: 200,
      message: 'Dataset draft abandoned',
      type: 'SUCCESS' as const,
      data: this.mapDraft(draft),
    };
  }

  private mapDraft(draft: {
    id: string;
    name: string | null;
    workspaceId: string;
    sourceIds: string[];
    status: string;
    currentArtifactId: string | null;
    savedDatasetId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: draft.id,
      name: draft.name,
      workspaceId: draft.workspaceId,
      sourceIds: draft.sourceIds,
      status: draft.status,
      currentArtifactId: draft.currentArtifactId,
      savedDatasetId: draft.savedDatasetId,
      createdAt: draft.createdAt.toISOString(),
      updatedAt: draft.updatedAt.toISOString(),
    };
  }

  // ── bronze: materialize ──────────────────────────────────────────────────

  /**
   * Materialize the draft's BRONZE artifact. Mirrors
   * `DatasetVersionAuthorizedService.createRawVersionService` exactly, with
   * one deliberate difference: the `DataSource` lookup is scoped to
   * `draft.sourceIds`, not `dataset.sourceIds` — the same credential-scoping
   * guard, replicated because there is no Dataset row yet to scope through
   * (`feature_list.preprocessing.json` → `decisions.draft_architecture
   * .source_scoping`).
   */
  async materializeDraftArtifactService(
    user: Auth.UserPayload,
    draftId: string,
    dto: CreateRawVersionDto,
  ) {
    const draft = await this.assertDraftAccess(draftId, user);

    const source = draft.sourceIds.includes(dto.sourceId)
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
    const runId = dto.runId ?? randomUUID();
    const startedAt = Date.now();
    const scope = `drafts/${draftId}`;

    const stats = ArtifactStatsSchema.parse(
      await postToPython(
        '/v1/preprocess/materialize',
        {
          target_key: artifactKey(scope, artifactId),
          ...buildSourceBlock(source, dto),
        },
        PYTHON_TIMEOUT.preprocess,
      ),
    );

    // Same shape as the saved-dataset path: artifact row + owner's pointer,
    // together, so a committed artifact the draft does not point at is never
    // invisible to a read. `datasetId` stays null — adoption at Save sets it
    // later without rewriting this row's bytes or its `draftId`.
    const artifact = await this.prisma.$transaction(async (tx) => {
      const created = await tx.datasetArtifact.create({
        data: {
          id: artifactId,
          draftId,
          runId,
          parentArtifactId: null,
          type: 'BRONZE',
          objectKey: stats.object_key,
          checksum: stats.checksum,
          rowCount: stats.row_count,
          columnCount: stats.column_count,
          missingPct: stats.missing_pct,
          sizeBytes: BigInt(stats.size_bytes),
          operations: [],
          columnStatsKey: stats.column_stats_key,
          durationMs: Date.now() - startedAt,
          createdById: user.id,
        },
      });
      await tx.datasetDraft.update({
        where: { id: draftId },
        data: { currentArtifactId: created.id },
      });
      return created;
    });

    return {
      statusCode: 201,
      message: 'Draft bronze artifact created successfully',
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

  // ── rows ─────────────────────────────────────────────────────────────────

  async listDraftRowsService(
    user: Auth.UserPayload,
    draftId: string,
    artifactId: string,
    query: ListRowsDto,
  ) {
    await this.assertDraftAccess(draftId, user);
    const artifact = await this.prisma.datasetArtifact.findFirst({
      where: { id: artifactId, draftId },
      select: { objectKey: true },
    });
    if (!artifact) {
      throw new AppException({
        statusCode: 404,
        message: 'Draft artifact not found',
        type: 'ERROR',
      });
    }

    const pythonBody = {
      source_key: artifact.objectKey,
      offset: query.offset,
      limit: query.limit,
      ...(query.tags && { tags: query.tags }),
      ...(query.startTime && { start_time: query.startTime }),
      ...(query.endTime && { end_time: query.endTime }),
    };

    if (query.format === 'arrow') {
      // DS-LAKE-005B-A-T05 (rescoped: server-side transport only), mirrors
      // dataset-version.authorized.service.ts::listRowsService exactly.
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
   * (DS-LAKE-005B-A-T01).
   *
   * `rowCount`, `tagCount` (the existing `columnCount` field — LOGICAL tags),
   * `missingPct`, `checksum` and `createdAt` already sit on the
   * `DatasetArtifact` row from the write that produced it, so those are
   * served with zero I/O. `columnCount` here is the PHYSICAL width instead —
   * `{tag}` + `{tag}__status` per tag — computed, not stored, so it can never
   * drift from `tagCount`. `tags` and the time range are the only fields that
   * need the connector: nothing else opens `data.parquet` for this call.
   */
  async getDraftArtifactMetadataService(
    user: Auth.UserPayload,
    draftId: string,
    artifactId: string,
  ) {
    await this.assertDraftAccess(draftId, user);
    const artifact = await this.prisma.datasetArtifact.findFirst({
      where: { id: artifactId, draftId },
    });
    if (!artifact) {
      throw new AppException({
        statusCode: 404,
        message: 'Draft artifact not found',
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
   * Paginated, searchable tag catalog (DS-LAKE-005B-A-T03) — same footer-only
   * read as metadata, so browsing 8,000+ tags never opens `data.parquet`'s
   * tag or status columns.
   */
  async getDraftArtifactTagCatalogService(
    user: Auth.UserPayload,
    draftId: string,
    artifactId: string,
    query: TagCatalogDto,
  ) {
    await this.assertDraftAccess(draftId, user);
    const artifact = await this.prisma.datasetArtifact.findFirst({
      where: { id: artifactId, draftId },
      select: { objectKey: true },
    });
    if (!artifact) {
      throw new AppException({
        statusCode: 404,
        message: 'Draft artifact not found',
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
   * Per-tag aggregate stats sidecar (DS-LAKE-005B-A-T07), mirrors
   * `dataset-version.authorized.service.ts::getArtifactColumnStatsService`
   * exactly. Short-circuits on `columnStatsKey` before calling Python for
   * the same reason: a missing sidecar is knowable from Postgres alone.
   */
  async getDraftArtifactColumnStatsService(
    user: Auth.UserPayload,
    draftId: string,
    artifactId: string,
  ) {
    await this.assertDraftAccess(draftId, user);
    const artifact = await this.prisma.datasetArtifact.findFirst({
      where: { id: artifactId, draftId },
      select: { objectKey: true, columnStatsKey: true },
    });
    if (!artifact) {
      throw new AppException({
        statusCode: 404,
        message: 'Draft artifact not found',
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
   * Preview a cleaning pipeline against a draft artifact without applying it.
   * Creates no object, no job, no artifact row — exactly like the dataset
   * path's `previewService`.
   *
   * T01 (DS-LAKE-005) was deferred: the interactive scrubber keeps computing
   * every intermediate step locally for instant feedback. This exists only
   * for the HYBRID the user chose afterward — a single server-verified check
   * once the scrubber settles on the FINAL step, debounced client-side. It is
   * not wired into every keystroke.
   */
  async previewDraftService(
    user: Auth.UserPayload,
    draftId: string,
    artifactId: string,
    dto: PreviewVersionDto,
  ) {
    await this.assertDraftAccess(draftId, user);
    const artifact = await this.prisma.datasetArtifact.findFirst({
      where: { id: artifactId, draftId },
      select: { objectKey: true },
    });
    if (!artifact) {
      throw new AppException({
        statusCode: 404,
        message: 'Draft artifact not found',
        type: 'ERROR',
      });
    }

    const preview = PythonPreviewSchema.parse(
      await postToPython(
        '/v1/preprocess/preview',
        {
          source_key: artifact.objectKey,
          operations: dto.operations,
          precision: dto.precision,
          ...(dto.sampleRows && { sample_rows: dto.sampleRows }),
          ...(dto.previewRows && { preview_rows: dto.previewRows }),
          ...(dto.tags && { tags: dto.tags }),
          ...(dto.startTime && { start_time: dto.startTime }),
          ...(dto.endTime && { end_time: dto.endTime }),
          // DS-LAKE-005B-A-T06: bypasses the sample_rows head cut on the
          // Python side when set — mirrors previewService's forwarding.
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

  // ── silver: clean job ────────────────────────────────────────────────────

  /**
   * Start a draft-scoped cleaning job — the "server on Apply" half of the
   * confirmed UX (Step 3.2 keeps its instant local preview; committing a
   * cleaning step drives this real async job). Answers 202 immediately, same
   * as the saved-dataset path (CLAUDE.md §5).
   */
  async startDraftCleanJobService(
    user: Auth.UserPayload,
    draftId: string,
    artifactId: string,
    dto: StartCleanJobDto,
  ) {
    await this.assertDraftAccess(draftId, user);
    const source = await this.prisma.datasetArtifact.findFirst({
      where: { id: artifactId, draftId },
      select: { id: true },
    });
    if (!source) {
      throw new AppException({
        statusCode: 404,
        message: 'Draft artifact not found',
        type: 'ERROR',
      });
    }

    const job = await this.prisma.preprocessingJob.create({
      data: {
        draftId,
        sourceArtifactId: source.id,
        status: 'QUEUED',
        stage: 'CLEAN',
        totalSteps: dto.operations.length,
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

  async getDraftJobService(
    user: Auth.UserPayload,
    draftId: string,
    jobId: string,
  ) {
    await this.assertDraftAccess(draftId, user);
    const job = await this.prisma.preprocessingJob.findFirst({
      where: { id: jobId, draftId },
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
        sourceArtifactId: job.sourceArtifactId,
        resultArtifactId: job.resultArtifactId,
        startedAt: job.startedAt?.toISOString() ?? null,
        finishedAt: job.finishedAt?.toISOString() ?? null,
      },
    };
  }

  async cancelDraftJobService(
    user: Auth.UserPayload,
    draftId: string,
    jobId: string,
  ) {
    await this.assertDraftAccess(draftId, user);
    const job = await this.prisma.preprocessingJob.findFirst({
      where: { id: jobId, draftId },
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

  async retryDraftJobService(
    user: Auth.UserPayload,
    draftId: string,
    jobId: string,
  ) {
    await this.assertDraftAccess(draftId, user);
    const previous = await this.prisma.preprocessingJob.findFirst({
      where: { id: jobId, draftId },
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
        draftId,
        sourceArtifactId: previous.sourceArtifactId,
        status: 'QUEUED',
        stage: previous.stage,
        totalSteps: previous.totalSteps,
        operations: previous.operations as PrismaTypes.InputJsonValue,
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
