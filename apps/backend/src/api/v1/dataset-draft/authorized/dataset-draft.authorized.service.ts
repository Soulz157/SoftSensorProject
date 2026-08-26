import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService, PrismaTypes } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import {
  postBinaryToPython,
  postToPython,
  PYTHON_TIMEOUT,
} from '@/lib/python-client';
import { artifactKey, PIPELINE_VERSION_REORDERED } from '@/lib/artifact-keys';
import { buildSourceBlock } from '@/lib/source-block';
import { PreprocessingJobService } from '../../dataset-version/authorized/preprocessing-job.service';
import { LoaderJobService } from '../../loader/loader-job.service';
import {
  ArtifactStatsSchema,
  PythonArtifactAdoptSchema,
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
  type ResplitDraftHoldoutDto,
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

  private isUniqueViolation(err: unknown): boolean {
    return (
      err instanceof PrismaTypes.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    );
  }

  /**
   * DS-LAKE-024-T02. Resolve-or-create the edit-mode draft for a saved
   * Dataset — idempotent on re-entry, per DS-LAKE-010-T08's own recorded
   * incident (duplicate ACTIVE drafts left by a browser-Back exit).
   *
   * NEVER re-materializes from the source. `decisions.
   * seeded_from_the_adopted_bronze_never_a_refetch`: the dataset's own
   * lineage-root BRONZE is already lineage-pinned by
   * `artifact-cleanup-eligibility.ts` for as long as any non-ARCHIVED
   * `DatasetVersion` references it, so its bytes are guaranteed present —
   * re-fetching would cost minutes, could return DIFFERENT rows (a PI
   * archive absorbs backfills), and would make the edit session
   * non-reproducible against the version it started from.
   *
   * THE BORROWED-ROOT PROBLEM: every draft-scoped lookup in this service is
   * written `where: { id, draftId }` (`resolvePristineBronzeRoot` above,
   * `createDraftFeaturesArtifactService`, `startDraftCleanJobService`, …).
   * An artifact owned by the ORIGINAL draft would 404 against the new edit
   * draft's id. Rather than point `currentArtifactId` at a foreign row (no
   * FK enforces that column, but every OTHER draft-scoped query would still
   * refuse it), this mints a SECOND `DatasetArtifact` row — owned by the new
   * draft (`draftId` set, `datasetId` null), sharing the root's `objectKey`
   * (and every other descriptive field) VERBATIM. No bytes are copied and no
   * object is written — this is the same share-by-pointer shape
   * `promoteDraftArtifactToFinalService` already uses for FINAL, one layer
   * over. `DatasetArtifact_owner_present`'s CHECK constraint is `datasetId
   * IS NOT NULL OR draftId IS NOT NULL` — "at least one", not "exactly
   * one" — so two rows sharing one `objectKey` is legal; there is no
   * uniqueness constraint on `objectKey` either (the FINAL/GOLD pair already
   * did this before DS-LAKE-025 gave FINAL its own copy).
   *
   * Race safety: the partial unique index
   * `DatasetDraft_one_active_edit_per_dataset` (hand-written migration,
   * `editingDatasetId` WHERE `status = 'ACTIVE'`) makes concurrent creates
   * for the same dataset race on ONE index — the loser's insert throws P2002,
   * caught below, and falls back to reading the winner's row rather than
   * producing a second ACTIVE draft.
   */
  async resolveOrCreateEditDraftService(
    user: Auth.UserPayload,
    datasetId: string,
  ) {
    const existing = await this.prisma.datasetDraft.findFirst({
      where: { editingDatasetId: datasetId, status: 'ACTIVE' },
    });
    if (existing) {
      return {
        statusCode: 200,
        message: 'Edit draft resolved',
        type: 'SUCCESS' as const,
        data: this.mapDraft(existing),
      };
    }

    // Ownership-scoped the same way `getDatasetService` scopes a read —
    // `createdById`, not workspace membership (drafts use workspace
    // membership because no Dataset exists yet to check ownership through;
    // here one already does).
    const dataset = await this.prisma.dataset.findFirst({
      where: { id: datasetId, createdById: user.id },
      select: { id: true, name: true, workspaceId: true, sourceIds: true },
    });
    if (!dataset) {
      throw new AppException({
        statusCode: 404,
        message: 'Dataset not found',
        type: 'ERROR',
      });
    }

    // The dataset's adopted lineage-root BRONZE (DS-LAKE-017-T01/T02) — the
    // SAME row `adoptedBronzeArtifactId` resolves
    // (`dataset.authorized.service.ts`'s own `artifacts` select). Read
    // directly here rather than through that select because this service
    // needs the FULL row (to clone its descriptive fields onto the shared
    // artifact below), not just its id.
    const root = await this.prisma.datasetArtifact.findFirst({
      where: { datasetId, type: 'BRONZE', objectReclaimedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!root) {
      throw new AppException({
        statusCode: 422,
        message:
          'This dataset has no readable raw artifact to edit from — its ' +
          'stored bytes may have been reclaimed. Re-fetch the dataset from ' +
          'its source before editing.',
        type: 'ERROR',
      });
    }

    try {
      const draft = await this.prisma.$transaction(async (tx) => {
        const draft = await tx.datasetDraft.create({
          data: {
            workspaceId: dataset.workspaceId,
            sourceIds: dataset.sourceIds,
            name: dataset.name,
            editingDatasetId: dataset.id,
            createdById: user.id,
          },
        });

        // Fresh runId: this is the START of the edit draft's OWN chain, a
        // different run from whichever fetch originally produced `root`'s
        // bytes (`resolvePristineBronzeRoot`'s own doc comment: "each
        // re-fetch mints a new runId chain"). Every validation* field is
        // copied verbatim — T04's pristine-root gate reads this shared row's
        // `validationRowCount`, and it must describe the TRUE state of the
        // underlying object, which `root` already recorded.
        const sharedRoot = await tx.datasetArtifact.create({
          data: {
            draftId: draft.id,
            runId: randomUUID(),
            parentArtifactId: null,
            type: 'BRONZE',
            objectKey: root.objectKey,
            format: root.format,
            checksum: root.checksum,
            schemaVersion: root.schemaVersion,
            columnCount: root.columnCount,
            featureCount: root.featureCount,
            rowCount: root.rowCount,
            missingPct: root.missingPct,
            sizeBytes: root.sizeBytes,
            operations: root.operations as PrismaTypes.InputJsonValue,
            validationRowCount: root.validationRowCount,
            validationHoldoutFrom: root.validationHoldoutFrom,
            validationMissingPct: root.validationMissingPct,
            createdById: user.id,
          },
        });

        await tx.datasetDraft.update({
          where: { id: draft.id },
          data: { currentArtifactId: sharedRoot.id },
        });

        return draft;
      });

      return {
        statusCode: 201,
        message: 'Edit draft created',
        type: 'SUCCESS' as const,
        data: this.mapDraft(draft),
      };
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        const winner = await this.prisma.datasetDraft.findFirst({
          where: { editingDatasetId: datasetId, status: 'ACTIVE' },
        });
        if (winner) {
          return {
            statusCode: 200,
            message: 'Edit draft resolved',
            type: 'SUCCESS' as const,
            data: this.mapDraft(winner),
          };
        }
      }
      throw err;
    }
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

  /**
   * DS-LAKE-014-T04: bumps `updatedAt` on an ACTIVE draft, no more. This is
   * the wizard's own heartbeat — called periodically while a tab is visibly
   * open — so DS-LAKE-014-T02's ACTIVE-draft idle sweep measures real
   * absence (tab closed/backgrounded) rather than silence (a user reading
   * Step 3.1's charts, issuing no other write for many minutes).
   *
   * `updateMany` with a `status: 'ACTIVE'` filter, writing the status the
   * row already has, NOT an empty `data: {}` — two things depend on this:
   *   1. `@updatedAt` needs a real SET clause to fire at all; an empty
   *      `data` risks Prisma emitting none, which would make the heartbeat
   *      a silent no-op — exactly the failure mode that would turn the
   *      short idle tier into the hostile blanket rule this feature's own
   *      userDecisions record rejecting.
   *   2. Filtering on `status: 'ACTIVE'` makes this a no-op on a SAVED or
   *      ABANDONED draft. Without it, a wizard tab left open after Save
   *      would keep pushing `updatedAt` forward and silently extend
   *      `CLEANUP_INTERMEDIATE_RETENTION_HOURS` for that dataset's
   *      intermediates — a heartbeat meant to protect an in-progress wizard
   *      has no business affecting a draft that has already been saved.
   */
  async touchDraftService(user: Auth.UserPayload, draftId: string) {
    await this.assertDraftAccess(draftId, user);
    const { count } = await this.prisma.datasetDraft.updateMany({
      where: { id: draftId, status: 'ACTIVE' },
      data: { status: 'ACTIVE' },
    });
    return {
      statusCode: 200,
      message:
        count > 0
          ? 'Dataset draft heartbeat recorded'
          : 'Dataset draft is not ACTIVE — heartbeat ignored',
      type: 'SUCCESS' as const,
      data: { touched: count > 0 },
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
    editingDatasetId: string | null;
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
      // DS-LAKE-024. Null for a create-mode draft — see
      // DatasetDraft.editingDatasetId's own doc comment for why this is a
      // separate column from savedDatasetId, not the same one read twice.
      editingDatasetId: draft.editingDatasetId,
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
          target_key: artifactKey(scope, artifactId, 'BRONZE'),
          ...buildSourceBlock(source, dto),
          // DS-LAKE-018-T03. Absent when no holdout was selected — python's
          // own MaterializeRequest.holdout is optional and behaves exactly
          // as today when omitted.
          ...(dto.holdout && {
            holdout: { from_time: dto.holdout.from, to_time: dto.holdout.to },
          }),
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
          // DS-LAKE-018-T03. null when no holdout was requested — matches
          // Python's own None default, never defaulted to 0 (0 would claim
          // an empty holdout was written, which is a different fact).
          validationRowCount: stats.validation_row_count ?? null,
          // MODEL-FLOW-010-T06. Same null-when-no-holdout convention.
          validationMissingPct: stats.validation_missing_pct ?? null,
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
        validationRowCount: artifact.validationRowCount,
      },
    };
  }

  /**
   * Walk up an artifact's `parentArtifactId` chain to its BRONZE root — the
   * only artifact type with a null parent (schema's own invariant: "Null for
   * a BRONZE root"). Starts from `currentArtifactId` rather than querying
   * `{type: 'BRONZE', parentArtifactId: null}` directly: a draft can carry
   * more than one BRONZE root across separate wizard runs (each re-fetch
   * mints a new `runId` chain, per `DatasetArtifact.runId`'s own doc
   * comment), and only the chain the draft is CURRENTLY on is the correct
   * target for a holdout re-split.
   */
  private async resolvePristineBronzeRoot(
    draftId: string,
    currentArtifactId: string | null,
  ) {
    if (!currentArtifactId) {
      throw new AppException({
        statusCode: 404,
        message:
          'Draft has no artifact yet — fetch data before setting a holdout.',
        type: 'ERROR',
      });
    }

    const fetchArtifact = async (id: string) => {
      const found = await this.prisma.datasetArtifact.findFirst({
        where: { id, draftId },
      });
      if (!found) {
        throw new AppException({
          statusCode: 404,
          message: 'Draft artifact not found',
          type: 'ERROR',
        });
      }
      return found;
    };

    let artifact = await fetchArtifact(currentArtifactId);
    while (artifact.parentArtifactId) {
      artifact = await fetchArtifact(artifact.parentArtifactId);
    }
    if (artifact.type !== 'BRONZE') {
      throw new AppException({
        statusCode: 422,
        message: 'Could not resolve a BRONZE root for this draft artifact.',
        type: 'ERROR',
      });
    }
    return artifact;
  }

  /**
   * DS-LAKE-018-T06. Re-split the draft's PRISTINE (never-split) root BRONZE
   * against a new holdout window, without re-fetching from the source.
   *
   * UNREACHABLE FROM THE WIZARD as of DS-LAKE-023's edit-mode re-split pass
   * — `use-dataset-holdout-resplit.ts` (the client's only caller of this
   * route) is no longer called by any UI; every new holdout, in both
   * modes, is now cut at the FEATURES stage instead, never here. Retained
   * for API compatibility only. Its own guards are effectively dead code as
   * a result, though left correct rather than removed: `dto.holdout ===
   * null` (below) stays reachable in principle, but the 422 branch on
   * `root.validationRowCount !== null` can no longer trigger — no draft
   * BRONZE materialized by this wizard will ever carry that column again,
   * since the client no longer sends a holdout to
   * `materializeDraftArtifactService` either.
   *
   * Original doc, still accurate about the mechanism itself:
   *
   * Companion to `materializeDraftArtifactService`'s own holdout branch, for
   * the case that branch cannot cover: the holdout picker used to live at
   * Step 3.1 (`ValidationHoldoutSection`, since moved to Step 4 and, per the
   * paragraph above, off this endpoint entirely), which mounted AFTER the
   * bronze warm had already materialized once with no holdout. Changing the
   * holdout there had to reach BRONZE some other way — this endpoint was
   * that way.
   *
   * ALWAYS reads `resolvePristineBronzeRoot`'s root, never the artifact
   * `currentArtifactId` happens to point at right now — re-splitting an
   * ALREADY-split frame would permanently shed the rows the previous split
   * cut into `validate_data.parquet`, with no way to reconstruct them (the
   * previous holdout boundary is not recoverable). A root whose
   * `validationRowCount` is already set means IT was split at materialize
   * time (a legacy dataset, or one materialized before this task existed) —
   * refused (422), not silently re-split.
   *
   * `holdout: null` clears a previously-picked holdout WITHOUT calling
   * Python: the pristine root already IS the no-holdout artifact, so this
   * just points the draft back at it.
   */
  async resplitDraftHoldoutService(
    user: Auth.UserPayload,
    draftId: string,
    dto: ResplitDraftHoldoutDto,
  ) {
    const draft = await this.assertDraftAccess(draftId, user);
    const root = await this.resolvePristineBronzeRoot(
      draft.id,
      draft.currentArtifactId,
    );

    if (dto.holdout === null) {
      await this.prisma.datasetDraft.update({
        where: { id: draftId },
        data: { currentArtifactId: root.id },
      });
      return {
        statusCode: 200,
        message: 'Holdout cleared — draft points back at its pristine artifact',
        type: 'SUCCESS' as const,
        data: {
          id: root.id,
          runId: root.runId,
          type: root.type,
          checksum: root.checksum,
          rowCount: root.rowCount,
          columnCount: root.columnCount,
          missingPct: root.missingPct,
          validationRowCount: root.validationRowCount,
        },
      };
    }

    if (root.validationRowCount !== null) {
      throw new AppException({
        statusCode: 422,
        message:
          'This artifact was already split at fetch time and cannot be re-split — re-fetch the data to change its holdout.',
        type: 'ERROR',
      });
    }

    const artifactId = randomUUID();
    const startedAt = Date.now();
    const scope = `drafts/${draftId}`;

    const stats = ArtifactStatsSchema.parse(
      await postToPython(
        '/v1/preprocess/resplit-holdout',
        {
          source_key: root.objectKey,
          target_key: artifactKey(scope, artifactId, 'BRONZE'),
          holdout: { from_time: dto.holdout.from, to_time: dto.holdout.to },
        },
        PYTHON_TIMEOUT.preprocess,
      ),
    );

    const artifact = await this.prisma.$transaction(async (tx) => {
      const created = await tx.datasetArtifact.create({
        data: {
          id: artifactId,
          draftId,
          runId: root.runId,
          parentArtifactId: root.id,
          type: 'BRONZE',
          objectKey: stats.object_key,
          checksum: stats.checksum,
          rowCount: stats.row_count,
          columnCount: stats.column_count,
          missingPct: stats.missing_pct,
          sizeBytes: BigInt(stats.size_bytes),
          operations: [],
          columnStatsKey: stats.column_stats_key,
          validationRowCount: stats.validation_row_count ?? null,
          validationHoldoutFrom: stats.validation_holdout_from
            ? new Date(stats.validation_holdout_from)
            : null,
          // MODEL-FLOW-010-T06. Same null-when-no-holdout convention.
          validationMissingPct: stats.validation_missing_pct ?? null,
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
      message: 'Draft bronze artifact re-split against the new holdout',
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

    // DS-LAKE-022-T03. The same recipe-driven stage decision the job runner
    // makes, mirrored here because this inline route is the OTHER of the only
    // two places an artifact's stage is chosen (verified by grepping every
    // `type: 'GOLD'` and `artifactKey(...)` call site in the backend).
    // `scale: false` means this write is the FEATURE stage alone, so it
    // commits SILVER with pipelineVersion 2; anything else is the legacy
    // combined write and commits GOLD with pipelineVersion null.
    const isReorderedFeatureCall = dto.scale === false;
    const artifactType = isReorderedFeatureCall ? 'SILVER' : 'GOLD';

    const stats = ArtifactStatsSchema.parse(
      await postToPython(
        '/v1/preprocess/features',
        {
          source_key: source.objectKey,
          target_key: artifactKey(scope, newArtifactId, artifactType),
          features: dto.features,
          selectedColumns: dto.selectedColumns ?? null,
          scalers: dto.scalers,
          overwrite: dto.overwrite ?? false,
          target_y: dto.targetY ?? null,
          // Omitted when the caller omitted it, so Python's own
          // `FeaturesRequest.scale` default owns the legacy behaviour rather
          // than a second copy of it living here.
          ...(dto.scale !== undefined && { scale: dto.scale }),
          // DS-LAKE-023-T01. Mirrors the job runner's own forwarding — this
          // inline route is the OTHER stage-decision site (comment above),
          // so it must not drift from what `startDraftFeaturesJobService`
          // now does.
          ...(dto.holdout && {
            holdout: { from_time: dto.holdout.from, to_time: dto.holdout.to },
          }),
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
          type: artifactType,
          // DS-LAKE-022-T03. Null for the legacy combined write — the same
          // value every pre-reorder artifact carries, because it is the same
          // claim. See PIPELINE_VERSION_REORDERED.
          pipelineVersion: isReorderedFeatureCall
            ? PIPELINE_VERSION_REORDERED
            : null,
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
          // DS-LAKE-023-T01. Set only when this call's own `dto.holdout`
          // requested one. See preprocessing-job.service.ts's `commit()`
          // for why all three are written together here.
          validationRowCount: stats.validation_row_count ?? null,
          validationHoldoutFrom: stats.validation_holdout_from
            ? new Date(stats.validation_holdout_from)
            : null,
          validationMissingPct: stats.validation_missing_pct ?? null,
          // DS-LAKE-023-T05. Set only when this call's own `dto.scale`
          // (defaulting True, same as Python) actually ran `to_model_ready`
          // — the FEATURE-only write (`scale: false`) never scales, so
          // Python never populates this field for it.
          droppedBadRows: stats.dropped_bad_rows ?? null,
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
          // DS-LAKE-022-T03. Carried from the promoted artifact, never
          // re-derived: a FINAL is a pointer promotion (same objectKey, same
          // checksum — DS-LAKE-012-V03), so it was produced by whichever
          // order produced its source. This is the field DS-LAKE-022-T08
          // reads to decide which ORDER to replay a recorded recipe in, and a
          // FINAL that dropped it would send a pre-reorder dataset down the
          // post-reorder replay path and break the byte-identical checksum
          // reproducibility DS-LAKE-012-T10 proved.
          pipelineVersion: source.pipelineVersion,
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

    // DS-LAKE-019-T05. Frozen at Save time, same reasoning as qualityScore
    // below: the MinIO sidecar (artifact.validationKey) is rewritten on
    // every Step 5 revalidate, so it cannot answer "what did Save actually
    // promise". A status PASS here can only carry ADVISORY failures — a
    // BLOCKING one would already have thrown above — so this is exactly
    // report.checks filtered to the advisory-and-failed subset.
    const validationAdvisory = report.checks
      .filter((check) => check.severity === 'advisory' && !check.passed)
      .map((check) => ({
        name: check.name,
        detail: check.detail,
        measured: check.measured ?? null,
        threshold: check.threshold ?? null,
        offenders: check.offenders,
      }));

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

    // DS-LAKE-025. Minted here rather than let Prisma default it inside the
    // transaction, because the adoption calls below need the dataset id to
    // build their destination prefix and they must run BEFORE the
    // transaction opens — they are network I/O, and holding a Postgres
    // transaction open across a multi-object MinIO copy is exactly the kind
    // of long-running write this codebase keeps outside `$transaction`
    // everywhere else (see the validate/metadata calls above).
    const datasetId = randomUUID();

    /**
     * Copy one artifact's objects out of draft space and into the dataset's
     * own prefix, returning the row updates that repoint it there.
     *
     * Until this existed, Save adopted the draft's artifact BY POINTER: the
     * saved dataset's `objectKey` still read `drafts/{draftId}/...`
     * permanently, so a registry dataset stayed readable only for as long as
     * draft-space bytes survived. Two saved datasets were found with theirs
     * already gone — `DatasetArtifact` rows live and `objectReclaimedAt`
     * null, MinIO returning NoSuchKey — which is the failure this whole
     * change exists to close.
     *
     * Promotion itself is untouched and stays pointer-only
     * (ADR-DS-LAKE-005B-B-006, `global_definition_of_done`: "Promotion
     * changes metadata only; no artifact is copied or regenerated"). The
     * copy happens HERE, at Save, which is a different boundary: the point
     * where the artifact stops being a draft's scratch output and becomes
     * the registry's permanent record.
     *
     * One consequence worth naming: a FINAL adopted this way DOES get a file
     * of its own, which `DATA_FILENAME_BY_TYPE`'s comment in object_store.py
     * says it never does. That comment describes promotion, and still holds
     * there. The copied object keeps its source stage's filename
     * (`data_gold.parquet`), so a FINAL's own key still says which stage it
     * came from.
     */
    const adopt = async (artifact: {
      id: string;
      objectKey: string;
    }): Promise<{
      objectKey: string;
      featureSpecKey: string | null;
      validationKey: string | null;
      columnStatsKey: string | null;
    }> => {
      const adopted = PythonArtifactAdoptSchema.parse(
        await postToPython(
          '/v1/preprocess/artifacts/adopt',
          {
            object_key: artifact.objectKey,
            dataset_id: datasetId,
            artifact_id: artifact.id,
          },
          PYTHON_TIMEOUT.preprocess,
        ),
      );
      return {
        objectKey: adopted.object_key,
        featureSpecKey: adopted.feature_spec_key,
        validationKey: adopted.validation_key,
        columnStatsKey: adopted.column_stats_key,
      };
    };

    // Runs before the transaction, so a copy failure throws with NO dataset
    // row created — Save stays all-or-nothing. `postToPython` already
    // surfaces a python error as an AppException.
    const lineageRoot = lineage[0];
    const adoptedFinal = await adopt(finalArtifact);
    // The FINAL-IS-the-root edge case (a draft promoted BRONZE straight to
    // FINAL): one artifact, one adoption, and the same guard the pointer
    // update below already applies.
    const adoptedRoot =
      lineageRoot.id === finalArtifact.id
        ? adoptedFinal
        : await adopt(lineageRoot);

    // The frozen snapshot must record where the bytes ACTUALLY live now. A
    // lineage entry still naming the draft key would point every later
    // reader — audit, reproduction, `computeProtectedArtifactIds` — at an
    // object cleanup is free to reclaim, re-creating the dangling pointer
    // this change removes.
    const adoptedKeyById = new Map<string, string>([
      [finalArtifact.id, adoptedFinal.objectKey],
      [lineageRoot.id, adoptedRoot.objectKey],
    ]);
    for (const link of lineage) {
      const adoptedKey = adoptedKeyById.get(link.id);
      if (adoptedKey) link.objectKey = adoptedKey;
    }

    const { dataset, version } = await this.prisma.$transaction(async (tx) => {
      const dataset = await tx.dataset.create({
        data: {
          id: datasetId,
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
        data: { datasetId: dataset.id, ...adoptedFinal },
      });

      // DS-LAKE-017-T01: adopt the lineage ROOT (BRONZE) too, ONE POINTER
      // NOT TWO — `Dataset.currentArtifactId` (set below via `version`,
      // read by every "current" caller) still resolves to FINAL only. This
      // only gives edit-mode hydration (T03) a `where: { id, datasetId }`
      // path to the raw bytes that were always sitting in MinIO, hard-pinned
      // by `artifact-cleanup-eligibility.ts` regardless of retention age —
      // a pointer/access-guard fix, not a data-loss fix (see findings).
      // `lineage[0]` is the root by construction (the walk above starts at
      // FINAL and unshifts back via `parentArtifactId` to the one link that
      // has none — BRONZE's own definition). Guarded against the
      // FINAL-IS-the-root edge case (a draft promoted BRONZE straight to
      // FINAL, zero intermediate stages) so that row is not update()'d
      // twice for the same field.
      //
      // DS-LAKE-025: `lineageRoot` is now hoisted above the transaction (it
      // is needed to build the adoption call), and the update carries
      // `adoptedRoot`'s new keys alongside the pointer. The BRONZE hard pin
      // in `artifact-cleanup-eligibility.ts` still exists and still matters
      // for datasets saved BEFORE this change; for one saved after it, the
      // root's bytes are no longer in draft space for that pin to protect.
      if (lineageRoot.id !== finalArtifact.id) {
        await tx.datasetArtifact.update({
          where: { id: lineageRoot.id },
          data: { datasetId: dataset.id, ...adoptedRoot },
        });
      }

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
          validationAdvisory: validationAdvisory,
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
        validationAdvisory,
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
      select: { id: true, pipelineVersion: true },
    });
    if (!source) {
      throw new AppException({
        statusCode: 404,
        message: 'Draft artifact not found',
        type: 'ERROR',
      });
    }

    // D4 (DS-LAKE-022 wizard reorder): a scaling tail only makes sense
    // against a SILVER that features produced WITHOUT scaling — i.e. one
    // stamped pipelineVersion 2 by a reordered FEATURE job (`scale: false`).
    // Sourcing it from anything else (a legacy combined-write GOLD, a
    // plain BRONZE, or a legacy SILVER that was never meant to carry a
    // trailing scale) would either scale an already-scaled frame or scale
    // raw/unfiltered data the reordered wizard never intended to hand this
    // stage. Refuse loudly rather than silently mis-scaling.
    if (
      dto.scaleRecipe !== undefined &&
      source.pipelineVersion !== PIPELINE_VERSION_REORDERED
    ) {
      throw new AppException({
        statusCode: 422,
        message:
          'A scaling tail requires a source artifact produced by the ' +
          'reordered feature stage (pipelineVersion 2); this artifact was not.',
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
          // DS-LAKE-022 activation: forward the reordered wizard's scaling
          // tail. Without this the runner's `readScaleRecipe` always reads
          // `raw.scaleRecipe` as absent, `isReorderedCleanJob` is always
          // false, and no draft-scoped clean job could ever take the
          // reordered path regardless of what the client sent.
          ...(dto.scaleRecipe !== undefined && {
            scaleRecipe: dto.scaleRecipe,
          }),
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
          // DS-LAKE-022 activation: forward the reordered wizard's opt-out
          // of the combined scale write. Without this the runner's
          // `readFeatureRecipe` always reads `raw.scale` as absent,
          // `isReorderedFeatureJob` is always false, and no draft-scoped
          // features job could ever take the reordered path regardless of
          // what the client sent.
          ...(dto.scale !== undefined && { scale: dto.scale }),
          // DS-LAKE-023-T01: same class of forwarding bug DS-LAKE-022 found
          // twice already (scaleRecipe, scale) — a DTO field built and
          // never carried onto the stored job payload leaves the runner's
          // read side permanently unreachable regardless of what Python
          // supports. Forwarded verbatim; the runner reads it back and
          // passes it to Python's `FeaturesRequest.holdout` unchanged.
          ...(dto.holdout !== undefined && { holdout: dto.holdout }),
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
