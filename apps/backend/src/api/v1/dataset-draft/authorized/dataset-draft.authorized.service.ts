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
import { LoaderJobService } from '../../loader/loader-job.service';
import {
  ArtifactStatsSchema,
  PythonBoxplotSchema,
  PythonColumnStatsSchema,
  PythonCorrelationSchema,
  PythonHistogramSchema,
  PythonMetadataSchema,
  PythonPreviewSchema,
  PythonRowsSchema,
  PythonScatterSchema,
  PythonTagCatalogSchema,
  ValidationReportSchema,
  type BoxplotRequestDto,
  type CorrelationRequestDto,
  type CreateFeaturesDto,
  type CreateRawVersionDto,
  type HistogramRequestDto,
  type ListRowsDto,
  type PreviewVersionDto,
  type ScatterRequestDto,
  type StartCleanJobDto,
  type TagCatalogDto,
  type ValidateArtifactDto,
  type PromoteFinalArtifactDto,
} from '../../dataset-version/authorized/dto/dataset-version.authorized.dto';
import {
  type CreateDraftDto,
  type SaveDraftAsDatasetDto,
} from './dto/dataset-draft.authorized.dto';

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
    private readonly loaderJobs: LoaderJobService,
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

  /**
   * DS-LAKE-006-T06. Runs feature engineering + column selection + scaling
   * SERVER-SIDE against an existing draft artifact (normally SILVER, but
   * not required to be — this adopts whatever `:artifactId` points at,
   * same artifact-stage-agnostic design already noted for the Save-from-
   * completed-artifact ADR). Produces a GOLD artifact.
   *
   * Inline, not job-queued — mirrors `materializeDraftArtifactService`
   * above, not `startDraftCleanJobService`: feature engineering is one
   * combined operation here, not a per-tag chained pipeline, so there is no
   * meaningful per-step progress to track. (Decided explicitly, not
   * assumed — see feature_list.preprocessing.json DS-LAKE-006-T06.)
   *
   * `parentArtifactId: source.id` is the REAL Postgres FK T05's own
   * verificationResults flagged as still missing — that gap closes here.
   */
  async createDraftFeaturesArtifactService(
    user: Auth.UserPayload,
    draftId: string,
    artifactId: string,
    dto: CreateFeaturesDto,
  ) {
    await this.assertDraftAccess(draftId, user);
    const source = await this.prisma.datasetArtifact.findFirst({
      where: { id: artifactId, draftId },
    });
    if (!source) {
      throw new AppException({
        statusCode: 404,
        message: 'Draft artifact not found',
        type: 'ERROR',
      });
    }

    const newArtifactId = randomUUID();
    const startedAt = Date.now();
    const scope = `drafts/${draftId}`;

    const stats = ArtifactStatsSchema.parse(
      await postToPython(
        '/v1/preprocess/features',
        {
          source_key: source.objectKey,
          target_key: artifactKey(scope, newArtifactId),
          features: dto.features,
          selectedColumns: dto.selectedColumns ?? null,
          scalers: dto.scalers,
          overwrite: dto.overwrite ?? false,
          target_y: dto.targetY ?? null,
        },
        PYTHON_TIMEOUT.preprocess,
      ),
    );

    const artifact = await this.prisma.$transaction(async (tx) => {
      const created = await tx.datasetArtifact.create({
        data: {
          id: newArtifactId,
          draftId,
          // Continues the SAME BRONZE -> SILVER -> GOLD -> FINAL chain the
          // source belongs to — unlike a fresh materialize, this is not a
          // lineage root, so it does not mint its own runId.
          runId: source.runId,
          parentArtifactId: source.id,
          type: 'GOLD',
          objectKey: stats.object_key,
          checksum: stats.checksum,
          rowCount: stats.row_count,
          columnCount: stats.column_count,
          missingPct: stats.missing_pct,
          sizeBytes: BigInt(stats.size_bytes),
          operations: dto.features,
          // No column_stats.json from /features — that sidecar is a
          // cleaning-op concern (drift/coverage/outlier), which this
          // endpoint has nothing to compute.
          columnStatsKey: stats.column_stats_key ?? null,
          featureSpecKey: stats.feature_spec_key ?? null,
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
    const skipped = stats.skipped_features ?? [];
    return {
      statusCode: 201,
      message:
        skipped.length > 0
          ? `Draft gold artifact created successfully (skipped ${skipped.length} feature(s) colliding with existing columns: ${skipped.join(', ')})`
          : 'Draft gold artifact created successfully',
      type: 'SUCCESS' as const,
      data: {
        id: artifact.id,
        runId: artifact.runId,
        parentArtifactId: artifact.parentArtifactId,
        type: artifact.type,
        checksum: artifact.checksum,
        rowCount: artifact.rowCount,
        columnCount: artifact.columnCount,
        missingPct: artifact.missingPct,
        featureSpecKey: artifact.featureSpecKey,
      },
    };
  }

  /**
   * DS-LAKE-007-T04. Thin endpoint (AskUserQuestion, this task): calls
   * Python, zod-parses the response, returns it. Creates or updates NO
   * DatasetArtifact row — a later task decides whether/how a PASS becomes
   * a FINAL artifact (the schema's own "validationKey on FINAL" comment
   * anticipates this, but it is not this task's job to build).
   *
   * `featureSpecKey` is read off the artifact BEING validated, not
   * supplied by the caller — see `ValidateArtifactSchema`'s own doc
   * comment for why a separate field would just be a second way to name
   * the wrong spec.
   */
  async validateDraftArtifactService(
    user: Auth.UserPayload,
    draftId: string,
    artifactId: string,
    dto: ValidateArtifactDto,
  ) {
    await this.assertDraftAccess(draftId, user);
    const artifact = await this.prisma.datasetArtifact.findFirst({
      where: { id: artifactId, draftId },
      select: { objectKey: true, featureSpecKey: true },
    });
    if (!artifact) {
      throw new AppException({
        statusCode: 404,
        message: 'Draft artifact not found',
        type: 'ERROR',
      });
    }

    const report = ValidationReportSchema.parse(
      await postToPython(
        '/v1/preprocess/validate',
        {
          source_key: artifact.objectKey,
          ...(artifact.featureSpecKey && {
            feature_spec_key: artifact.featureSpecKey,
          }),
          ...(dto.expectedTags && { expected_tags: dto.expectedTags }),
          ...(dto.maxMissingPct !== undefined && {
            max_missing_pct: dto.maxMissingPct,
          }),
          ...(dto.maxOutlierFraction !== undefined && {
            max_outlier_fraction: dto.maxOutlierFraction,
          }),
        },
        PYTHON_TIMEOUT.preprocess,
      ),
    );

    return {
      statusCode: 200,
      message: 'Validation report generated successfully',
      type: 'SUCCESS' as const,
      data: report,
    };
  }

  /**
   * DS-LAKE-009-T01. Promotes `:artifactId` (normally GOLD, but not
   * required to be — same artifact-stage-agnostic design as
   * `createDraftFeaturesArtifactService`: a dataset with no feature
   * engineering never has a GOLD artifact, and must still be saveable from
   * SILVER) into a FINAL artifact, ONLY if it validates PASS.
   *
   * Re-validates the source itself rather than trusting a caller-supplied
   * report key — accepting one from the request body would reopen
   * SERVER-side exactly the stale-PASS vector DS-LAKE-008-T03 closed
   * CLIENT-side. This is deliberately NOT redundant with DS-LAKE-009-T04:
   * this guards artifact PROMOTION (can a FAIL become a FINAL?); T04
   * guards the Save Dataset transaction itself (can something that was
   * never promoted through here still get committed as a version?) —
   * different entry point, different guard, both server-side.
   *
   * A FINAL artifact is a Postgres-only promotion, never a byte copy:
   * `DatasetArtifact.datasetId`'s own schema comment says artifacts are
   * "ADOPTED... never copied, never rewritten" — the same principle one
   * step earlier. `objectKey`/`checksum` are the SOURCE's, verbatim;
   * `ObjectStore` refuses a second write to an existing key anyway
   * (immutability), so there is no Python write here, only the /validate
   * read. `operations: []` — promotion applies no transform, same
   * convention as `materializeDraftArtifactService`'s BRONZE row.
   * `datasetId` is NOT set here (no `Dataset` exists yet) — DS-LAKE-009-T02
   * is where adoption happens, same as every earlier artifact stage.
   */
  async promoteDraftArtifactToFinalService(
    user: Auth.UserPayload,
    draftId: string,
    artifactId: string,
    dto: PromoteFinalArtifactDto,
  ) {
    await this.assertDraftAccess(draftId, user);
    const source = await this.prisma.datasetArtifact.findFirst({
      where: { id: artifactId, draftId },
    });
    if (!source) {
      throw new AppException({
        statusCode: 404,
        message: 'Draft artifact not found',
        type: 'ERROR',
      });
    }

    const startedAt = Date.now();
    const report = ValidationReportSchema.parse(
      await postToPython(
        '/v1/preprocess/validate',
        {
          source_key: source.objectKey,
          ...(source.featureSpecKey && {
            feature_spec_key: source.featureSpecKey,
          }),
          ...(dto.expectedTags && { expected_tags: dto.expectedTags }),
          ...(dto.maxMissingPct !== undefined && {
            max_missing_pct: dto.maxMissingPct,
          }),
          ...(dto.maxOutlierFraction !== undefined && {
            max_outlier_fraction: dto.maxOutlierFraction,
          }),
        },
        PYTHON_TIMEOUT.preprocess,
      ),
    );

    if (report.status !== 'PASS') {
      throw new AppException({
        statusCode: 422,
        message:
          `Validation failed — cannot promote to a final artifact ` +
          `(quality score ${report.quality_score}, failed: ` +
          `${report.failed_checks.join(', ') || 'unknown'}).`,
        type: 'ERROR',
      });
    }

    const finalArtifactId = randomUUID();

    const artifact = await this.prisma.$transaction(async (tx) => {
      const created = await tx.datasetArtifact.create({
        data: {
          id: finalArtifactId,
          draftId,
          runId: source.runId,
          parentArtifactId: source.id,
          type: 'FINAL',
          objectKey: source.objectKey,
          checksum: source.checksum,
          rowCount: source.rowCount,
          columnCount: source.columnCount,
          missingPct: source.missingPct,
          sizeBytes: source.sizeBytes,
          operations: [],
          columnStatsKey: source.columnStatsKey,
          featureSpecKey: source.featureSpecKey,
          validationKey: report.validation_report_key,
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
      message: 'Draft final artifact created successfully',
      type: 'SUCCESS' as const,
      data: {
        id: artifact.id,
        runId: artifact.runId,
        parentArtifactId: artifact.parentArtifactId,
        type: artifact.type,
        checksum: artifact.checksum,
        rowCount: artifact.rowCount,
        columnCount: artifact.columnCount,
        missingPct: artifact.missingPct,
        featureSpecKey: artifact.featureSpecKey,
        validationKey: artifact.validationKey,
        qualityScore: report.quality_score,
      },
    };
  }

  /**
   * DS-LAKE-009-T02. The ONLY place a `DatasetVersion` is ever created
   * (DS-LAKE-009-T05 audits this claim). Adopts the draft's FINAL artifact
   * BY POINTER — never re-fetches raw, never replays the recipe
   * (ADR-DS-LAKE-005B-B-006).
   *
   * Looks up the FINAL artifact explicitly (`type: 'FINAL'`, newest first)
   * rather than trusting `draft.currentArtifactId`, which can drift back to
   * GOLD if the recipe is edited after promotion (advisor-flagged). 422s if
   * none exists — a draft that never went through `.../finalize` has
   * nothing valid to save.
   *
   * Re-validates that artifact for a fresh Save-time quality score:
   * `DatasetVersion.qualityScore`'s own schema comment says "at Save time,
   * frozen" — copying a number computed at promotion time would violate
   * that. This doubles as DS-LAKE-009-T04's guard (refuses an artifactId
   * that was never promoted through T01, or whose bytes no longer PASS) as
   * a direct consequence, not by duplicating T01's check — T04 remains its
   * own task to harden/verify this further, not reinvent it.
   *
   * `versionNumber` is read inside the transaction (DS-LAKE-009-T03),
   * against the just-created `dataset.id` via `tx`, not `this.prisma` —
   * every write here always creates a brand-new `Dataset` in the SAME
   * transaction, so no other row can share its id and no other write can
   * be racing it for that id specifically. The read-then-insert pattern is
   * not airtight under Postgres's default READ COMMITTED (two concurrent
   * transactions targeting the SAME datasetId could both read "no rows
   * yet" and compute the same next number) — `@@unique([datasetId,
   * versionNumber])` is the actual backstop, surfacing as a raw Prisma
   * P2002 rather than a mapped `AppException`. `createDatasetService` (the
   * plain CRUD path, `@@unique([workspaceId, name])`) has the same
   * untranslated-P2002 gap today — kept consistent with that precedent
   * rather than adding handling here alone. Recorded explicitly, not
   * silently assumed solved: today this is provably unreachable (every
   * save creates a fresh Dataset, so `datasetId` can never collide across
   * two concurrent saves), and stays that way until some future path
   * saves a SECOND version onto an EXISTING dataset.
   *
   * `draft.status === 'SAVED'` is refused up front (409) — a reachable
   * concurrency hole distinct from T03's own versionNumber question,
   * closed here rather than left for T04: `assertDraftAccess` does not
   * check status, and the FINAL artifact stays findable by
   * `{ draftId, type: 'FINAL' }` after adoption (`draftId` is kept, per
   * the adoption comment above) — without this guard, a second save of an
   * already-saved draft would create a SECOND `Dataset`, re-point the same
   * artifact's `datasetId` away from the first, and overwrite
   * `savedDatasetId`, leaving dataset #1's `currentArtifactId` dangling.
   */
  async saveDraftAsDatasetService(
    user: Auth.UserPayload,
    draftId: string,
    dto: SaveDraftAsDatasetDto,
  ) {
    const draft = await this.assertDraftAccess(draftId, user);
    if (draft.status === 'SAVED') {
      throw new AppException({
        statusCode: 409,
        message:
          'Draft has already been saved as a Dataset — a draft can only ' +
          'be saved once.',
        type: 'ERROR',
      });
    }

    const finalArtifact = await this.prisma.datasetArtifact.findFirst({
      where: { draftId, type: 'FINAL' },
      orderBy: { createdAt: 'desc' },
    });
    if (!finalArtifact) {
      throw new AppException({
        statusCode: 422,
        message:
          'Draft has no finalized artifact to save — promote one via ' +
          '.../artifacts/:artifactId/finalize first.',
        type: 'ERROR',
      });
    }

    // DS-LAKE-009-T04: no expectedTags/maxMissingPct/maxOutlierFraction
    // overrides here (see SaveDraftAsDatasetSchema's own doc comment) —
    // Save re-checks against the artifact's own thresholds, it does not
    // let the caller configure new ones.
    const report = ValidationReportSchema.parse(
      await postToPython(
        '/v1/preprocess/validate',
        {
          source_key: finalArtifact.objectKey,
          ...(finalArtifact.featureSpecKey && {
            feature_spec_key: finalArtifact.featureSpecKey,
          }),
        },
        PYTHON_TIMEOUT.preprocess,
      ),
    );

    if (report.status !== 'PASS') {
      throw new AppException({
        statusCode: 422,
        message:
          `Validation failed — cannot save dataset (quality score ` +
          `${report.quality_score}, failed: ` +
          `${report.failed_checks.join(', ') || 'unknown'}).`,
        type: 'ERROR',
      });
    }

    // Frozen lineage snapshot: walk parentArtifactId from FINAL back to the
    // BRONZE root, root-first. DatasetArtifact.parentArtifactId stays the
    // live, queryable chain — this is the point-in-time copy a saved
    // version promises never changes underneath it.
    type ArtifactLink = {
      id: string;
      type: string;
      checksum: string;
      objectKey: string;
      parentArtifactId: string | null;
    };
    const lineage: Array<{
      id: string;
      type: string;
      checksum: string;
      objectKey: string;
    }> = [];
    let cursor: ArtifactLink | null = finalArtifact;
    while (cursor) {
      lineage.unshift({
        id: cursor.id,
        type: cursor.type,
        checksum: cursor.checksum,
        objectKey: cursor.objectKey,
      });
      cursor = cursor.parentArtifactId
        ? await this.prisma.datasetArtifact.findUnique({
            where: { id: cursor.parentArtifactId },
          })
        : null;
    }

    // DS-LAKE-005B-B-T01 (Step 5 leg). `tags` joins rowCount/missingPct/
    // columnCount/etc. above as an artifact-derived field: when the caller
    // omits it, the FINAL artifact's own logical tag list is read via the
    // same Python `/metadata` call `getDraftArtifactMetadataService` already
    // makes — footer-only, no parquet rows opened. Runs outside
    // `$transaction`, same discipline as the validate call above it. A
    // caller that still sends an explicit `tags` array (legacy UI path) is
    // honoured as-is.
    const tags =
      dto.tags ??
      PythonMetadataSchema.parse(
        await postToPython(
          '/v1/preprocess/metadata',
          { source_key: finalArtifact.objectKey },
          PYTHON_TIMEOUT.metadata,
        ),
      ).tags;

    const { dataset, version } = await this.prisma.$transaction(async (tx) => {
      const dataset = await tx.dataset.create({
        data: {
          name: dto.name,
          description: dto.description ?? null,
          workspaceId: draft.workspaceId,
          sourceIds: draft.sourceIds,
          tags,
          pipelineConfig: dto.pipelineConfig as PrismaTypes.InputJsonValue,
          fileUrl: dto.fileUrl ?? null,
          rowCount: finalArtifact.rowCount,
          missingPct: finalArtifact.missingPct,
          createdById: user.id,
        },
      });

      // Adopt by pointer — datasetId set, draftId kept for traceability,
      // never copied/rewritten (DatasetArtifact.datasetId's own comment).
      await tx.datasetArtifact.update({
        where: { id: finalArtifact.id },
        data: { datasetId: dataset.id },
      });

      // DS-LAKE-009-T03: read inside the transaction, via `tx` — see the
      // method doc comment for why this narrows but does not eliminate the
      // race, and why that gap is provably unreachable today.
      const last = await tx.datasetVersion.findFirst({
        where: { datasetId: dataset.id },
        orderBy: { versionNumber: 'desc' },
        select: { versionNumber: true },
      });
      const versionNumber = (last?.versionNumber ?? 0) + 1;

      const version = await tx.datasetVersion.create({
        data: {
          datasetId: dataset.id,
          versionNumber,
          semanticVersion: `${versionNumber}.0.0`,
          artifactId: finalArtifact.id,
          checksum: finalArtifact.checksum,
          schemaVersion: finalArtifact.schemaVersion,
          columnCount: finalArtifact.columnCount,
          featureCount: finalArtifact.featureCount,
          rowCount: finalArtifact.rowCount,
          missingPct: finalArtifact.missingPct,
          sizeBytes: finalArtifact.sizeBytes,
          qualityScore: report.quality_score,
          status: 'DRAFT',
          lineage: lineage,
          createdById: user.id,
        },
      });

      await tx.dataset.update({
        where: { id: dataset.id },
        data: {
          currentArtifactId: finalArtifact.id,
          currentVersionId: version.id,
        },
      });

      await tx.datasetDraft.update({
        where: { id: draftId },
        data: { savedDatasetId: dataset.id, status: 'SAVED' },
      });

      return { dataset, version };
    });

    // DS-LAKE-011-T03: enqueue AFTER the transaction has committed, never
    // inside it — a loader failure must never fail or roll back Save
    // (AC0). `enqueue` itself never throws for a sink-side failure (see
    // its own doc comment); only a genuine job-row write failure would
    // reach here, and that is intentionally NOT caught — a save that
    // already succeeded reporting an unrelated post-commit error is more
    // honest than silently swallowing it.
    await this.loaderJobs.enqueue(dataset.id, version.id, user.id);

    return {
      statusCode: 201,
      message: 'Dataset saved successfully',
      type: 'SUCCESS' as const,
      data: {
        id: dataset.id,
        versionId: version.id,
        versionNumber: version.versionNumber,
        artifactId: finalArtifact.id,
        qualityScore: report.quality_score,
        lineage,
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

  /**
   * DS-LAKE-005B-D-T01. Histogram/KDE for Step 3.1's DataAnalysisCard —
   * same shape as `previewDraftService` immediately above (artifact lookup,
   * forward the operations payload, zod-parse the Python response, return
   * it as-is). Creates no object, job or artifact — read-only, same
   * guarantee `/preview` makes.
   */
  async getDraftArtifactHistogramService(
    user: Auth.UserPayload,
    draftId: string,
    artifactId: string,
    dto: HistogramRequestDto,
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

    const histogram = PythonHistogramSchema.parse(
      await postToPython(
        '/v1/preprocess/histogram',
        {
          source_key: artifact.objectKey,
          operations: dto.operations,
          precision: dto.precision,
          tags: dto.tags,
          ...(dto.sampleRows && { sample_rows: dto.sampleRows }),
          ...(dto.startTime && { start_time: dto.startTime }),
          ...(dto.endTime && { end_time: dto.endTime }),
          ...(dto.kdeSamples && { kde_samples: dto.kdeSamples }),
          ...(dto.binCount && { bin_count: dto.binCount }),
        },
        PYTHON_TIMEOUT.metadata,
      ),
    );

    return {
      statusCode: 200,
      message: 'Histogram generated successfully',
      type: 'SUCCESS' as const,
      data: histogram,
    };
  }

  /**
   * DS-LAKE-005B-D-T03. Box plot for Step 3.1's DataAnalysisCard — same
   * shape as `getDraftArtifactHistogramService` immediately above (artifact
   * lookup, forward the operations payload, zod-parse the Python response,
   * return it as-is). Creates no object, job or artifact — read-only, same
   * guarantee `/preview` and `/histogram` make.
   */
  async getDraftArtifactBoxplotService(
    user: Auth.UserPayload,
    draftId: string,
    artifactId: string,
    dto: BoxplotRequestDto,
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

    const boxplot = PythonBoxplotSchema.parse(
      await postToPython(
        '/v1/preprocess/boxplot',
        {
          source_key: artifact.objectKey,
          operations: dto.operations,
          precision: dto.precision,
          tags: dto.tags,
          ...(dto.sampleRows && { sample_rows: dto.sampleRows }),
          ...(dto.startTime && { start_time: dto.startTime }),
          ...(dto.endTime && { end_time: dto.endTime }),
          ...(dto.outlierCap && { outlier_cap: dto.outlierCap }),
        },
        PYTHON_TIMEOUT.metadata,
      ),
    );

    return {
      statusCode: 200,
      message: 'Box plot generated successfully',
      type: 'SUCCESS' as const,
      data: boxplot,
    };
  }

  /**
   * DS-LAKE-005B-D-T04. Scatter cloud + regression for Step 3.1's
   * DataAnalysisCard — same shape as `getDraftArtifactHistogramService`/
   * `getDraftArtifactBoxplotService` above (artifact lookup, forward the
   * operations payload, zod-parse the Python response, return it as-is).
   * Creates no object, job or artifact — read-only, same guarantee
   * `/preview`, `/histogram` and `/boxplot` make.
   */
  async getDraftArtifactScatterService(
    user: Auth.UserPayload,
    draftId: string,
    artifactId: string,
    dto: ScatterRequestDto,
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

    const scatter = PythonScatterSchema.parse(
      await postToPython(
        '/v1/preprocess/scatter',
        {
          source_key: artifact.objectKey,
          operations: dto.operations,
          precision: dto.precision,
          x_tag: dto.xTag,
          y_tag: dto.yTag,
          ...(dto.sampleRows && { sample_rows: dto.sampleRows }),
          ...(dto.startTime && { start_time: dto.startTime }),
          ...(dto.endTime && { end_time: dto.endTime }),
          ...(dto.maxPoints && { max_points: dto.maxPoints }),
        },
        PYTHON_TIMEOUT.metadata,
      ),
    );

    return {
      statusCode: 200,
      message: 'Scatter data generated successfully',
      type: 'SUCCESS' as const,
      data: scatter,
    };
  }

  /**
   * DS-LAKE-005B-D-T05b. Correlation matrix over a server-resolved column
   * list for Step 3.1's DataAnalysisCard — same shape as the histogram/
   * boxplot/scatter services above. Creates no object, job or artifact —
   * read-only, same guarantee every other chart endpoint makes.
   */
  async getDraftArtifactCorrelationService(
    user: Auth.UserPayload,
    draftId: string,
    artifactId: string,
    dto: CorrelationRequestDto,
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

    const correlation = PythonCorrelationSchema.parse(
      await postToPython(
        '/v1/preprocess/correlation',
        {
          source_key: artifact.objectKey,
          operations: dto.operations,
          precision: dto.precision,
          tags: dto.tags,
          ...(dto.sampleRows && { sample_rows: dto.sampleRows }),
          ...(dto.startTime && { start_time: dto.startTime }),
          ...(dto.endTime && { end_time: dto.endTime }),
          ...(dto.topK && { top_k: dto.topK }),
        },
        PYTHON_TIMEOUT.metadata,
      ),
    );

    return {
      statusCode: 200,
      message: 'Correlation matrix generated successfully',
      type: 'SUCCESS' as const,
      data: correlation,
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

  // ── gold: feature engineering job ───────────────────────────────────────

  /**
   * Start a draft-scoped feature-engineering job — the async replacement
   * for `createDraftFeaturesArtifactService` below (DS-LAKE-006-T06
   * reversal: feature engineering now runs as a `PreprocessingJob`, matching
   * `/clean`, per an explicit user decision — the inline route is KEPT
   * running during the transition, not removed, so existing callers and
   * `step-5-review-save.tsx`'s gating on a 201 response are undisturbed
   * until the client is switched over).
   *
   * `stage: 'FEATURE'` is the first-ever writer of that enum value.
   * `operations` stores `{ features, selectedColumns, scalers }` — a
   * different JSON shape than CLEAN's `{ operations, precision }`, read
   * back by the runner's `readFeatureRecipe`, never `readOperations`.
   */
  async startDraftFeaturesJobService(
    user: Auth.UserPayload,
    draftId: string,
    artifactId: string,
    dto: CreateFeaturesDto,
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
        stage: 'FEATURE',
        // One combined Python call, not a chained per-tag pipeline — the
        // runner sets totalSteps to 1 itself once it reads this row (see
        // preprocessing-job.service.ts's own comment on why), not
        // dto.features.length; left at the Prisma column default here.
        operations: {
          features: dto.features,
          selectedColumns: dto.selectedColumns ?? null,
          scalers: dto.scalers,
          targetY: dto.targetY ?? null,
        },
        createdById: user.id,
      },
    });

    this.jobs.start(job.id);

    return {
      statusCode: 202,
      message: 'Feature engineering job accepted',
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
