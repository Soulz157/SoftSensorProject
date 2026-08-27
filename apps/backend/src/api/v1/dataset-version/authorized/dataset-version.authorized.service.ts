import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService, PrismaTypes } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import {
  postBinaryToPython,
  postToPython,
  PYTHON_TIMEOUT,
} from '@/lib/python-client';
import { presignArtifact } from '@/lib/python-preprocess-client';
import {
  artifactKey,
  sidecarKey,
  VALIDATE_DATA_FILENAME,
} from '@/lib/artifact-keys';
import { buildSourceBlock } from '@/lib/source-block';
import { isLegalTransition } from '@/lib/dataset-version-transitions';
import { PreprocessingJobService } from './preprocessing-job.service';
import { LoaderJobService } from '../../loader/loader-job.service';
import {
  ArtifactStatsSchema,
  BoxplotRequestDto,
  CorrelationRequestDto,
  HistogramRequestDto,
  PythonBoxplotSchema,
  PythonColumnStatsSchema,
  PythonCorrelationSchema,
  PythonHistogramSchema,
  PythonMetadataSchema,
  PythonPreviewSchema,
  PythonRowsSchema,
  PythonScatterSchema,
  PythonTagCatalogSchema,
  ScatterRequestDto,
  type CreateRawVersionDto,
  type ListRowsDto,
  type PreviewVersionDto,
  type PromoteVersionStatusDto,
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
    private readonly loaderJobs: LoaderJobService,
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
        // DS-LAKE-010-T04. Every other named registry field (status,
        // semanticVersion, qualityScore, rowCount, featureCount, owner via
        // createdBy) was already here — checksum was the one gap.
        checksum: item.checksum,
        qualityScore: item.qualityScore,
        // DS-LAKE-019-T05. Frozen at Save time, same as qualityScore right
        // above — null on a version saved before this feature existed.
        validationAdvisory: item.validationAdvisory,
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
   * DS-LAKE-010-T01/T02/T05: moves a DatasetVersion's own `status` through
   * the registry lifecycle. Pure metadata — no artifact, no MinIO call, no
   * `postToPython` — the ONE write is `datasetVersion.update({data:
   * {status}})`, nothing else on the row changes (AC0: objectKey/checksum
   * byte-identical before/after, trivially true since neither field is
   * touched).
   *
   * Same-state requests short-circuit to a no-write success BEFORE
   * consulting `isLegalTransition` — see that module's own doc comment for
   * why idempotency is handled here, not folded into the predicate.
   */
  async promoteVersionService(
    user: Auth.UserPayload,
    datasetId: string,
    versionId: string,
    dto: PromoteVersionStatusDto,
  ) {
    await this.assertDatasetAccess(datasetId, user);
    const version = await this.prisma.datasetVersion.findFirst({
      where: { id: versionId, datasetId },
      select: { id: true, status: true },
    });
    if (!version) {
      throw new AppException({
        statusCode: 404,
        message: 'Dataset version not found',
        type: 'ERROR',
      });
    }

    if (version.status === dto.status) {
      return {
        statusCode: 200,
        message: `Version is already ${dto.status}`,
        type: 'SUCCESS' as const,
        data: { id: version.id, status: version.status },
      };
    }

    if (!isLegalTransition(version.status, dto.status)) {
      throw new AppException({
        statusCode: 422,
        message: `Illegal transition: ${version.status} -> ${dto.status}. Legal path is DRAFT -> VALIDATED -> ACTIVE -> DEPRECATED -> ARCHIVED, one step at a time.`,
        type: 'ERROR',
      });
    }

    // T05: at most one ACTIVE version per dataset. Refused, not
    // auto-demoted — see dataset-version-transitions.ts's doc comment for
    // why. Read-then-write inside a transaction narrows the race the same
    // way DS-LAKE-009-T03's versionNumber allocation does (see that
    // method's own comment on why the residual window is accepted, not
    // eliminated, here for the same reason: no acceptance criterion or
    // verification item requires surviving a genuinely concurrent double
    // promote, and the smallest safe solution matches existing precedent
    // rather than introducing a new locking primitive for it).
    if (dto.status === 'ACTIVE') {
      const updated = await this.prisma.$transaction(async (tx) => {
        const otherActive = await tx.datasetVersion.findFirst({
          where: { datasetId, status: 'ACTIVE', id: { not: versionId } },
          select: { id: true },
        });
        if (otherActive) {
          throw new AppException({
            statusCode: 422,
            message: `Dataset already has an ACTIVE version (${otherActive.id}). Demote it to DEPRECATED first.`,
            type: 'ERROR',
          });
        }
        return tx.datasetVersion.update({
          where: { id: versionId },
          data: { status: dto.status },
          select: { id: true, status: true },
        });
      });
      return {
        statusCode: 200,
        message: `Version promoted to ${updated.status}`,
        type: 'SUCCESS' as const,
        data: updated,
      };
    }

    const updated = await this.prisma.datasetVersion.update({
      where: { id: versionId },
      data: { status: dto.status },
      select: { id: true, status: true },
    });
    return {
      statusCode: 200,
      message: `Version promoted to ${updated.status}`,
      type: 'SUCCESS' as const,
      data: updated,
    };
  }

  /**
   * DS-LAKE-010-T03: returns the FROZEN lineage snapshot recorded at Save
   * time (`DatasetVersion.lineage`, DS-LAKE-009), root-first (BRONZE
   * first). Deliberately NOT a live `parentArtifactId` walk — DS-LAKE-009B
   * stamps `objectReclaimedAt` on reclaimed intermediates and leaves the
   * row, so a live walk could return artifacts whose bytes are already
   * gone; the frozen snapshot is what a saved version actually promises.
   *
   * A version saved before this snapshot existed has `lineage: null` — it
   * genuinely cannot resolve back to BRONZE (AC3), so this 404s rather than
   * returning an empty array that would misrepresent "resolved to nothing"
   * as success.
   */
  async getVersionLineageService(
    user: Auth.UserPayload,
    datasetId: string,
    versionId: string,
  ) {
    await this.assertDatasetAccess(datasetId, user);
    const version = await this.prisma.datasetVersion.findFirst({
      where: { id: versionId, datasetId },
      select: { id: true, lineage: true },
    });
    if (!version) {
      throw new AppException({
        statusCode: 404,
        message: 'Dataset version not found',
        type: 'ERROR',
      });
    }
    if (!version.lineage) {
      throw new AppException({
        statusCode: 404,
        message:
          'No lineage snapshot recorded for this version (it predates the lineage feature).',
        type: 'ERROR',
      });
    }

    // The DB column is Prisma's generic JSON type; the shape actually
    // written is frozen and known (dataset-draft.authorized.service.ts's
    // `saveDraftAsDatasetService`, the ONLY writer of this column) — cast,
    // not `any`, matching this codebase's write-side precedent for the
    // same JSON column (`lineage: lineage` there is typed at the write,
    // this is the equivalent at the read).
    const lineage = version.lineage as unknown as Array<{
      id: string;
      type: string;
      checksum: string;
      objectKey: string;
    }>;

    return {
      statusCode: 200,
      message: 'Lineage fetched successfully',
      type: 'SUCCESS' as const,
      data: { versionId: version.id, lineage },
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
          target_key: artifactKey(datasetId, artifactId, 'BRONZE'),
          ...buildSourceBlock(source, dto),
          // DS-LAKE-018-T03. Mirrors materializeDraftArtifactService exactly
          // (this method's own doc comment).
          ...(dto.holdout && {
            holdout: { from_time: dto.holdout.from, to_time: dto.holdout.to },
          }),
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
          // DS-LAKE-018-T03. null when no holdout was requested — mirrors
          // materializeDraftArtifactService.
          validationRowCount: stats.validation_row_count ?? null,
          // MODEL-FLOW-010-T06. Same null-when-no-holdout convention.
          validationMissingPct: stats.validation_missing_pct ?? null,
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
        validationRowCount: artifact.validationRowCount,
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
    try {
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
    } catch (err) {
      if ((err as { statusCode?: number })?.statusCode === 422) {
        throw new AppException({
          statusCode: 404,
          message:
            'Column statistics sidecar is recorded but missing from storage.',
          type: 'ERROR',
        });
      }
      throw err;
    }
  }

  /**
   * MODEL-FLOW-010-T06 (widened lookup). Shared by `getArtifactHoldoutService`
   * and `getArtifactValidationRowsService` — both need "which artifact in
   * this run actually carries the validation split", and a single query
   * means the two can never disagree on which sibling that is.
   *
   * `artifactId` can be BRONZE/SILVER/GOLD/FINAL (`SavedDataset.currentArtifactId`
   * is stage-polymorphic), so the holdout is resolved via the artifact's
   * `runId`, not its own type — and NOT via a fixed BRONZE-sibling lookup
   * either. DS-LAKE-022's reordered pipeline (features before cleaning) moved
   * where the split is written: `validate_data.parquet` is now sidecar'd
   * beside SILVER, not BRONZE, on any run using the reordered order. This
   * finds whichever sibling in the run actually carries the validation
   * columns, by those columns rather than by a stage assumption —
   * `orderBy: createdAt desc` breaks the tie deterministically on a run with
   * more than one candidate (e.g. two BRONZE rows from a re-materialize,
   * only one of which split a holdout).
   */
  private async findHoldoutArtifact(runId: string) {
    return this.prisma.datasetArtifact.findFirst({
      where: {
        runId,
        validationRowCount: { not: null },
        validationHoldoutFrom: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        objectKey: true,
        validationRowCount: true,
        validationHoldoutFrom: true,
        validationMissingPct: true,
      },
    });
  }

  /**
   * MODEL-FLOW-010-T06. The raw validation holdout window for the given
   * artifact's run, read-only — no client-facing route exposed this before
   * (only `model-run.authorized.service.ts::tryReplayHoldout` resolved it,
   * server-side, at training-claim time).
   *
   * Returns `holdout: null` — NOT a 404 — when the dataset has no holdout
   * (the overwhelming majority) or the artifact predates this feature. A
   * missing holdout is a normal state with its own UI copy, the same
   * discipline `getArtifactColumnStatsService`'s `missing` state already
   * established for a missing column_stats.json sidecar.
   */
  async getArtifactHoldoutService(
    user: Auth.UserPayload,
    datasetId: string,
    artifactId: string,
  ) {
    await this.assertDatasetAccess(datasetId, user);
    const artifact = await this.prisma.datasetArtifact.findFirst({
      where: { id: artifactId, datasetId },
      select: { runId: true },
    });
    if (!artifact) {
      throw new AppException({
        statusCode: 404,
        message: 'Dataset artifact not found',
        type: 'ERROR',
      });
    }

    const holdoutArtifact = await this.findHoldoutArtifact(artifact.runId);
    if (!holdoutArtifact) {
      return {
        statusCode: 200,
        message: 'This dataset has no validation holdout',
        type: 'SUCCESS' as const,
        data: { holdout: null },
      };
    }

    // Footer-only read (never data.parquet's rows) for the window's end —
    // `validationHoldoutFrom` above is the exact persisted boundary, but
    // `holdout_to` itself was never persisted (only used transiently at
    // split time), so the last timestamp actually written to
    // validate_data.parquet is the honest stand-in for "where the window
    // ends" (DS-LAKE-018's own row_count precedent for a derived-not-
    // requested figure).
    //
    // Derived from `holdoutArtifact.objectKey` (the key actually written),
    // not rebuilt from `datasetId` — a draft-built dataset's artifact lives
    // under `drafts/{draftId}/…`, not `{datasetId}/…`, and
    // `validate_data.parquet` was written beside that real key (bug fixed
    // here: the old `validateDataKey(datasetId, bronze.id)` call
    // 404'd/NoSuchKey'd for every such dataset).
    let meta: ReturnType<typeof PythonMetadataSchema.parse>;
    try {
      meta = PythonMetadataSchema.parse(
        await postToPython(
          '/v1/preprocess/metadata',
          {
            source_key: sidecarKey(
              holdoutArtifact.objectKey,
              VALIDATE_DATA_FILENAME,
            ),
          },
          PYTHON_TIMEOUT.metadata,
        ),
      );
    } catch (err) {
      if ((err as { statusCode?: number })?.statusCode === 422) {
        // Same `missing` discipline as `getArtifactColumnStatsService`: the
        // row says a holdout was recorded, but its sidecar object is gone
        // from storage — do not let the raw object key in Python's error
        // text reach the browser console (that leak is what originally
        // surfaced this bug's symptom).
        throw new AppException({
          statusCode: 404,
          message:
            'Validation holdout is recorded but its data is missing from storage.',
          type: 'ERROR',
        });
      }
      throw err;
    }

    return {
      statusCode: 200,
      message: 'Validation holdout fetched successfully',
      type: 'SUCCESS' as const,
      data: {
        holdout: {
          holdoutFrom: holdoutArtifact.validationHoldoutFrom!.toISOString(),
          holdoutTo: meta.end_time,
          rowCount: holdoutArtifact.validationRowCount!,
          // Null for a holdout captured before MODEL-FLOW-010-T06 — the
          // panel must say so plainly, never silently omit the figure or
          // imply a clean 0%.
          missingPct: holdoutArtifact.validationMissingPct,
        },
      },
    };
  }

  /**
   * Compare view (train vs. validation). Reads a bounded page of
   * `validate_data.parquet` for the artifact's run, via the same
   * `findHoldoutArtifact` lookup `getArtifactHoldoutService` uses — so the
   * two can never resolve a different sibling for the same artifact.
   *
   * Reuses `ListRowsDto`/`PythonRowsSchema` and the JSON branch of
   * `listRowsService` exactly: same bound (`ListRowsSchema.limit`, default
   * 1,000, ceiling `MAX_SAMPLE_ROWS`), same tag-projection query shape. No
   * `format: 'arrow'` branch — no current caller needs it, and adding one
   * unused is dead code (CLAUDE.md "Minimal Changes").
   *
   * 404s — never `rows: null` — both when there is no holdout to read and
   * when one was recorded but its sidecar is gone from storage, matching
   * `getArtifactHoldoutService`'s own two-reasons-are-different discipline.
   * A caller only reaches this route after that endpoint already reported
   * `holdout !== null`, so either 404 here means state changed between the
   * two calls (e.g. cleanup ran in between) — worth surfacing as an error,
   * not silently swallowing into an empty chart.
   */
  async getArtifactValidationRowsService(
    user: Auth.UserPayload,
    datasetId: string,
    artifactId: string,
    query: ListRowsDto,
  ) {
    await this.assertDatasetAccess(datasetId, user);
    const artifact = await this.prisma.datasetArtifact.findFirst({
      where: { id: artifactId, datasetId },
      select: { runId: true },
    });
    if (!artifact) {
      throw new AppException({
        statusCode: 404,
        message: 'Dataset artifact not found',
        type: 'ERROR',
      });
    }

    const holdoutArtifact = await this.findHoldoutArtifact(artifact.runId);
    if (!holdoutArtifact) {
      throw new AppException({
        statusCode: 404,
        message: 'This dataset has no validation holdout',
        type: 'ERROR',
      });
    }

    const pythonBody = {
      source_key: sidecarKey(holdoutArtifact.objectKey, VALIDATE_DATA_FILENAME),
      offset: query.offset,
      limit: query.limit,
      ...(query.tags && { tags: query.tags }),
    };

    let page: ReturnType<typeof PythonRowsSchema.parse>;
    try {
      page = PythonRowsSchema.parse(
        await postToPython(
          '/v1/preprocess/rows',
          pythonBody,
          PYTHON_TIMEOUT.fetch,
        ),
      );
    } catch (err) {
      if ((err as { statusCode?: number })?.statusCode === 422) {
        throw new AppException({
          statusCode: 404,
          message:
            'Validation holdout is recorded but its data is missing from storage.',
          type: 'ERROR',
        });
      }
      throw err;
    }

    return {
      statusCode: 200,
      message: 'Validation rows fetched successfully',
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

  /**
   * DS-LAKE-005B-D-T05b (saved leg). Mirrors
   * `dataset-draft.authorized.service.ts::getDraftArtifactCorrelationService`
   * exactly — same Python call, same zod parse, response returned unmapped.
   * The only difference is the access rule and the artifact lookup key
   * (`datasetId` rather than `draftId`), the same divergence every other
   * paired method in these two services already has.
   */
  async getArtifactCorrelationService(
    user: Auth.UserPayload,
    datasetId: string,
    artifactId: string,
    dto: CorrelationRequestDto,
  ) {
    await this.assertDatasetAccess(datasetId, user);
    const artifact = await this.prisma.datasetArtifact.findFirst({
      where: { id: artifactId, datasetId },
      select: { objectKey: true },
    });
    if (!artifact) {
      throw new AppException({
        statusCode: 404,
        message: 'Artifact not found',
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

  async getArtifactHistogramService(
    user: Auth.UserPayload,
    datasetId: string,
    artifactId: string,
    dto: HistogramRequestDto,
  ) {
    await this.assertDatasetAccess(datasetId, user);
    const artifact = await this.prisma.datasetArtifact.findFirst({
      where: { id: artifactId, datasetId },
      select: { objectKey: true },
    });
    if (!artifact) {
      throw new AppException({
        statusCode: 404,
        message: 'Artifact not found',
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

  async getArtifactBoxplotService(
    user: Auth.UserPayload,
    datasetId: string,
    artifactId: string,
    dto: BoxplotRequestDto,
  ) {
    await this.assertDatasetAccess(datasetId, user);
    const artifact = await this.prisma.datasetArtifact.findFirst({
      where: { id: artifactId, datasetId },
      select: { objectKey: true },
    });
    if (!artifact) {
      throw new AppException({
        statusCode: 404,
        message: 'Artifact not found',
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
      message: 'Boxplot generated successfully',
      type: 'SUCCESS' as const,
      data: boxplot,
    };
  }

  async getArtifactScatterService(
    user: Auth.UserPayload,
    datasetId: string,
    artifactId: string,
    dto: ScatterRequestDto,
  ) {
    await this.assertDatasetAccess(datasetId, user);
    const artifact = await this.prisma.datasetArtifact.findFirst({
      where: { id: artifactId, datasetId },
      select: { objectKey: true },
    });
    if (!artifact) {
      throw new AppException({
        statusCode: 404,
        message: 'Artifact not found',
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
      message: 'Boxplot generated successfully',
      type: 'SUCCESS' as const,
      data: scatter,
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
        resultArtifactId: job.resultArtifactId,
        startedAt: job.startedAt?.toISOString() ?? null,
        finishedAt: job.finishedAt?.toISOString() ?? null,
      },
    };
  }

  /**
   * DS-LAKE-011-T05: job status endpoint so a future UI can report load
   * progress. Field-by-field response (no spread of the raw Prisma row),
   * same convention as every other endpoint in this file.
   */
  async getLoaderJobStatusService(
    user: Auth.UserPayload,
    datasetId: string,
    jobId: string,
  ) {
    await this.assertDatasetAccess(datasetId, user);
    const job = await this.loaderJobs.getStatus(datasetId, jobId);

    return {
      statusCode: 200,
      message: 'Loader job fetched successfully',
      type: 'SUCCESS' as const,
      data: {
        id: job.id,
        datasetId: job.datasetId,
        versionId: job.versionId,
        status: job.status,
        error: job.error,
        attempts: job.attempts,
        startedAt: job.startedAt?.toISOString() ?? null,
        finishedAt: job.finishedAt?.toISOString() ?? null,
      },
    };
  }

  /** DS-LAKE-011-T04: independent retry, mirrors retryJobService's own
   * access-check-then-delegate shape. */
  async retryLoaderJobService(
    user: Auth.UserPayload,
    datasetId: string,
    jobId: string,
  ) {
    await this.assertDatasetAccess(datasetId, user);
    // Ownership check before delegating -- loaderJobs.retry() itself has no
    // datasetId to scope against (mirrors retryJobService's own shape,
    // which also re-fetches inside the service after this same check).
    await this.loaderJobs.getStatus(datasetId, jobId);
    const result = await this.loaderJobs.retry(jobId);

    return {
      statusCode: 202,
      message: 'Retry accepted',
      type: 'SUCCESS' as const,
      data: result,
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

  // ── export ───────────────────────────────────────────────────────────────

  /**
   * DS-LAKE-021-T02. The dataset's `currentArtifactId` is stage-polymorphic
   * (per its own doc comment elsewhere in this file) — it is FINAL only once
   * the dataset is fully saved. This looks up the FINAL row explicitly rather
   * than trusting `currentArtifactId`, same discipline
   * `saveDraftAsDatasetService` already uses on the draft side, so an export
   * started against a dataset with no FINAL commit fails loudly instead of
   * exporting the wrong stage.
   */
  async startExportService(user: Auth.UserPayload, datasetId: string) {
    await this.assertDatasetAccess(datasetId, user);

    const final = await this.prisma.datasetArtifact.findFirst({
      where: { datasetId, type: 'FINAL' },
      orderBy: { createdAt: 'desc' },
    });
    if (!final) {
      throw new AppException({
        statusCode: 404,
        message: 'Dataset has no FINAL artifact to export.',
        type: 'ERROR',
      });
    }

    const job = await this.prisma.preprocessingJob.create({
      data: {
        datasetId,
        sourceArtifactId: final.id,
        stage: 'EXPORT',
        operations: { kind: 'export' },
        createdById: user.id,
      },
    });

    this.jobs.start(job.id);

    return {
      statusCode: 202,
      message: 'Export job started',
      type: 'SUCCESS' as const,
      data: { jobId: job.id, status: job.status },
    };
  }

  /**
   * DS-LAKE-021-T03. First NestJS method that hands a presigned URL to the
   * browser — every existing `presignArtifact` caller is server-to-server
   * (e.g. `ModelRunAuthorizedService.claim()` embeds one in its response to
   * the training container, not a browser tab). Presigns FRESH on every
   * call rather than caching a value from job completion — presigned URLs
   * expire (`expires_at`), so a stale link served from an old job payload
   * would 403 client-side with no way to recover short of re-running export.
   *
   * DS-LAKE-021-T04: presigns the EXPORT artifact's OWN `objectKey`
   * directly. It used to hop through `parentArtifactId` to the source
   * FINAL and presign ITS key with `sidecars: [EXPORT_CSV_FILENAME]` —
   * that was only ever necessary because the export object lived inside
   * the FINAL's own prefix. Now that an EXPORT artifact owns its key the
   * same way every other committed artifact type does, this is a single
   * lookup and a plain (no-sidecar) presign, same as any other artifact
   * download.
   */
  async getExportDownloadService(
    user: Auth.UserPayload,
    datasetId: string,
    artifactId: string,
  ) {
    await this.assertDatasetAccess(datasetId, user);

    const exportArtifact = await this.prisma.datasetArtifact.findFirst({
      where: { id: artifactId, datasetId, type: 'EXPORT' },
      select: { objectKey: true },
    });
    if (!exportArtifact) {
      throw new AppException({
        statusCode: 404,
        message: 'Export artifact not found for this dataset.',
        type: 'ERROR',
      });
    }

    // `data_url` is non-nullable per PresignArtifactSchema — Python's
    // presigned_get() signs a URL unconditionally, without checking the
    // object exists (that's what `sidecar_urls`' nullability was for, back
    // when the export lived as a sidecar). A genuinely missing export
    // object surfaces as a Python-side failure from `presignArtifact`
    // itself (it also reads the object's metadata/checksum), not a falsy
    // `data_url` here — so there is no separate 404 branch to write.
    const presigned = await presignArtifact({
      source_key: exportArtifact.objectKey,
    });

    return {
      statusCode: 200,
      message: 'Export download link',
      type: 'SUCCESS' as const,
      data: {
        downloadUrl: presigned.data_url,
        expiresAt: presigned.expires_at,
      },
    };
  }
}
