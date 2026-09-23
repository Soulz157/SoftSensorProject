import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTypes, PrismaModels } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import { artifactKey } from '@/lib/artifact-keys';
import {
  combineForRetrain,
  fetchArtifactMetadata,
} from '@/lib/python-preprocess-client';

/**
 * MODEL-SERVE-015. Everything `strategy: 'AUGMENT_DATA'` needs beyond what
 * `ModelRetrainAuthorizedService` already resolves for a plain (014)
 * retrain — a second service, not a widened method, because this is the
 * ONE new capability the feature introduces (`triggerRetrainService`'s doc
 * comment on the DTO amendment): merging two datasets is a materially
 * different operation from reading the incumbent's own artifact, and it
 * owns its own transaction and its own Python round trip.
 *
 * Split cleanly into two phases, called in order by the trigger:
 * `assertCompatible` (T02 — cheap, metadata-only, refuses BEFORE any
 * ModelCandidateJob row or any expensive Python work exists) and
 * `buildCombinedArtifact` (T03 — the actual merge, one Python call plus one
 * transaction).
 */
/**
 * MODEL-SERVE-015-T06. The suffix that marks a DatasetVersion as the output
 * of an augmented retrain rather than an operator's own Save.
 *
 * It lives on `semanticVersion` because `DatasetVersion` has no name/label
 * column, and because `listVersionsService` does not select `lineage` — so
 * this string is the only combined-ness signal a client can actually read.
 *
 * MIRRORED in the client at `apps/client/lib/retrain-handoff.ts`. It is
 * duplicated rather than shared because `@softsensor/common` depends on
 * NestJS and Fastify and is not safe to pull into the Next.js bundle; keep
 * the two in sync.
 */
export const AUGMENTED_VERSION_SUFFIX = '+augmented';

@Injectable()
export class ModelRetrainAugmentAuthorizedService {
  constructor(private readonly prisma: PrismaService) {}

  private isUniqueViolation(err: unknown): boolean {
    return (
      err instanceof PrismaTypes.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    );
  }

  /**
   * MODEL-SERVE-015-T02. Resolves and validates everything an AUGMENT_DATA
   * retrain needs, entirely from ids already on the incumbent's own source
   * run plus the operator's chosen DatasetVersion — never from anything the
   * request could otherwise name, the same "derived server-side" discipline
   * `TriggerRetrainSchema`'s own doc comment states for the plain path.
   *
   * Every refusal here fires BEFORE `triggerRetrainService` creates the
   * `ModelCandidateJob` row and before `buildCombinedArtifact` spends a
   * Python round trip — a bad request must cost nothing.
   */
  async assertCompatible(
    sourceRun: Pick<
      PrismaModels.ModelTrainingRunModel,
      'goldArtifactId' | 'featureSpecKey' | 'targetY' | 'splitSpec'
    >,
    additionalDatasetVersionId: string,
    /**
     * The operator's NEW-DATA validation window, carried through onto the
     * returned context. Not range-checked here: python is the layer that
     * loads the frame and can compare these against the new dataset's real
     * first/last timestamps, so it owns that refusal — exactly as it
     * already owns the `new_start` vs `cut_timestamp` one.
     */
    newValidationWindow?: { from: string; to: string },
  ): Promise<AugmentContext> {
    const split = sourceRun.splitSpec as {
      method?: string;
      ratio?: number;
      cut_timestamp?: string;
    } | null;
    // `resolveSplit` (ModelRetrainAuthorizedService) has already refused
    // cv_expanding and a missing ratio by the time this runs — this checks
    // the ONE thing that method does not: a usable computed boundary to
    // re-cut the frozen evaluation window against.
    const cutTimestamp = split?.cut_timestamp;
    if (!cutTimestamp) {
      throw new AppException({
        statusCode: 422,
        message:
          "The incumbent's source run records no computed split boundary " +
          '(cut_timestamp) — data augmentation needs one to freeze an ' +
          'evaluation window. Retrain without augmentation, or train a new ' +
          'model in the wizard.',
        type: 'ERROR',
      });
    }

    if (!sourceRun.featureSpecKey) {
      throw new AppException({
        statusCode: 422,
        message:
          "The incumbent's training artifact has no recorded feature " +
          'recipe (feature_spec.json) — there is nothing to reuse on the ' +
          'new dataset. Data augmentation requires a version trained with ' +
          'a feature-engineered artifact.',
        type: 'ERROR',
      });
    }

    const baseFinal = await this.prisma.datasetArtifact.findUnique({
      where: { id: sourceRun.goldArtifactId },
    });
    // Defensive, not expected: `buildRunData` (MODEL-SERVE-000) already
    // enforces every run trains on a committed FINAL artifact.
    if (!baseFinal || baseFinal.type !== 'FINAL' || !baseFinal.datasetId) {
      throw new AppException({
        statusCode: 422,
        message:
          "The incumbent's training artifact is not a committed FINAL " +
          'dataset artifact — cannot resolve a base dataset to combine.',
        type: 'ERROR',
      });
    }

    const newVersion = await this.prisma.datasetVersion.findUnique({
      where: { id: additionalDatasetVersionId },
    });
    if (!newVersion) {
      throw new AppException({
        statusCode: 404,
        message: `Dataset version ${additionalDatasetVersionId} not found.`,
        type: 'ERROR',
      });
    }
    if (!newVersion.artifactId) {
      throw new AppException({
        statusCode: 422,
        message:
          `Dataset version ${newVersion.versionNumber} has no committed ` +
          'FINAL artifact — save the dataset before using it to augment a ' +
          'retrain.',
        type: 'ERROR',
      });
    }
    const newFinal = await this.prisma.datasetArtifact.findUnique({
      where: { id: newVersion.artifactId },
    });
    if (!newFinal || newFinal.type !== 'FINAL') {
      throw new AppException({
        statusCode: 422,
        message: `Dataset version ${newVersion.versionNumber}'s artifact is not a committed FINAL artifact.`,
        type: 'ERROR',
      });
    }
    if (newFinal.objectReclaimedAt) {
      throw new AppException({
        statusCode: 422,
        message: `Dataset version ${newVersion.versionNumber}'s artifact has been reclaimed and is no longer available.`,
        type: 'ERROR',
      });
    }
    if (!newFinal.checksum) {
      throw new AppException({
        statusCode: 422,
        message: `Dataset version ${newVersion.versionNumber}'s artifact has no recorded checksum — re-verify it before using it to augment a retrain.`,
        type: 'ERROR',
      });
    }

    // Walk the lineage back to the nearest SILVER ancestor — the correct
    // source to apply the base's pinned recipe onto (see
    // CombineForRetrainRequest's own doc comment for why FINAL is the
    // wrong source: it was feature-engineered and scaled under the NEW
    // dataset's OWN fitted params, which disagree with the base's).
    let cursor: PrismaModels.DatasetArtifactModel | null = newFinal;
    while (cursor && cursor.type !== 'SILVER' && cursor.parentArtifactId) {
      cursor = await this.prisma.datasetArtifact.findUnique({
        where: { id: cursor.parentArtifactId },
      });
    }
    if (!cursor || cursor.type !== 'SILVER') {
      throw new AppException({
        statusCode: 422,
        message:
          `Dataset version ${newVersion.versionNumber} has no cleaned ` +
          '(SILVER) artifact in its lineage — this dataset must complete ' +
          'the cleaning stage before it can be used for augmentation.',
        type: 'ERROR',
      });
    }
    const newSource = cursor;

    const [baseMeta, newMeta] = await Promise.all([
      fetchArtifactMetadata(baseFinal.objectKey),
      fetchArtifactMetadata(newSource.objectKey),
    ]);

    if (!newMeta.tags.includes(sourceRun.targetY)) {
      throw new AppException({
        statusCode: 422,
        message:
          `'${sourceRun.targetY}' is not a column in dataset version ` +
          `${newVersion.versionNumber} — the two datasets must share the ` +
          'same target.',
        type: 'ERROR',
      });
    }
    const baseTags = new Set(baseMeta.tags);
    const newTags = new Set(newMeta.tags);
    const onlyBase = [...baseTags].filter((t) => !newTags.has(t)).sort();
    const onlyNew = [...newTags].filter((t) => !baseTags.has(t)).sort();
    if (onlyBase.length || onlyNew.length) {
      throw new AppException({
        statusCode: 422,
        message:
          'The incumbent and the selected dataset disagree on feature ' +
          `columns — only in the incumbent: ${onlyBase.join(', ') || 'none'}; ` +
          `only in the new dataset: ${onlyNew.join(', ') || 'none'}. The ` +
          'two datasets are not schema-compatible for augmentation.',
        type: 'ERROR',
      });
    }

    if (!newMeta.start_time) {
      throw new AppException({
        statusCode: 422,
        message: `Dataset version ${newVersion.versionNumber} has no readable timestamp range.`,
        type: 'ERROR',
      });
    }
    if (
      new Date(newMeta.start_time).getTime() <= new Date(cutTimestamp).getTime()
    ) {
      throw new AppException({
        statusCode: 422,
        message:
          `Dataset version ${newVersion.versionNumber} starts at ` +
          `${newMeta.start_time}, at or before the incumbent's own test ` +
          `window start (${cutTimestamp}) — no uncontaminated frozen ` +
          'evaluation window exists. Pick a dataset whose data begins ' +
          "after the incumbent's own split boundary.",
        type: 'ERROR',
      });
    }

    // The base DatasetVersion the incumbent was actually trained on — one
    // hop off the artifact, never `Model.datasetId` (015-T01's own finding
    // that the latter can have moved since).
    const baseVersion = await this.prisma.datasetVersion.findFirst({
      where: { artifactId: baseFinal.id },
      select: { id: true },
    });

    return {
      baseFinal,
      baseDatasetVersionId: baseVersion?.id ?? null,
      newFinal,
      newSource,
      newDatasetVersionId: newVersion.id,
      featureSpecKey: sourceRun.featureSpecKey,
      targetY: sourceRun.targetY,
      cutTimestamp,
      newValidationFrom: newValidationWindow?.from,
      newValidationTo: newValidationWindow?.to,
    };
  }

  /**
   * MODEL-SERVE-015-T03. The one Python round trip plus the one transaction
   * that mints the combined GOLD + FINAL pair. Called once per trigger,
   * AFTER `assertCompatible` — never re-entrant for a given call, so a
   * caller that wants to avoid re-combining on idempotent retry must check
   * for an existing job by `idempotencyKey` BEFORE calling this (the
   * trigger does).
   */
  /**
   * MODEL-SERVE-017. `combine: false` is the NEW_DATA_ONLY strategy — the
   * new rows are prepared through the identical recipe and the base's own
   * never-re-fit scalers, but the base's training rows are left out. The
   * artifact still lives in the BASE dataset's lineage and still carries the
   * base's frozen evaluation rows as its sidecar, because the candidate is
   * still scored against the incumbent on exactly those rows.
   */
  async buildCombinedArtifact(
    ctx: AugmentContext,
    user: Auth.UserPayload,
    combine = true,
  ): Promise<{
    combinedFinalArtifactId: string;
    combinedGoldArtifactId: string;
    combinedObjectKey: string;
    combinedChecksum: string;
    combinedFeatureSpecKey: string | null;
    combinedRowCount: number;
    combinedDatasetVersionId: string;
  }> {
    const combinedGoldArtifactId = randomUUID();
    // Base dataset's own id — never the new dataset's — matching the
    // decision this feature was built with: the combined artifact lives in
    // the BASE dataset's lineage.
    const targetKey = artifactKey(
      ctx.baseFinal.datasetId!,
      combinedGoldArtifactId,
      'GOLD',
    );

    const combined = await combineForRetrain({
      base_data_key: ctx.baseFinal.objectKey,
      base_feature_spec_key: ctx.featureSpecKey,
      new_data_key: ctx.newSource.objectKey,
      target_key: targetKey,
      target_y: ctx.targetY,
      cut_timestamp: ctx.cutTimestamp,
      combine,
      // Passed through as given. Python is the layer that can see the real
      // frame, so it owns the bounds check against the new dataset's actual
      // first/last timestamps — the same division of labour `new_start`
      // already follows.
      new_validation_from: ctx.newValidationFrom,
      new_validation_to: ctx.newValidationTo,
    });

    const combinedFinalArtifactId = randomUUID();
    // ONE runId shared by the GOLD row and its FINAL promotion — the same
    // convention `promoteDraftArtifactToFinalService` uses
    // (`runId: source.runId`), and the exact fact `findHoldoutArtifact`
    // depends on: it resolves a run's holdout by looking up the FINAL row
    // it trained on, reading ITS runId, then searching for a sibling
    // BRONZE/SILVER/GOLD row sharing that same runId.
    const sharedRunId = randomUUID();
    const operations = [
      {
        op: combine ? 'retrain_augment_combine' : 'retrain_new_data_only',
        baseArtifactId: ctx.baseFinal.id,
        newArtifactId: ctx.newFinal.id,
        newDatasetVersionId: ctx.newDatasetVersionId,
        baseTrainRowCount: combined.base_train_row_count,
        newTrainRowCount: combined.new_train_row_count,
        dedupeDropped: combined.dedupe_dropped,
        cutTimestamp: ctx.cutTimestamp,
        // The new-data validation window's own facts, when one was carved
        // out. `newValidationKey` is what `tryReplayHoldout` resolves at
        // claim time to build the second holdout; the row counts and
        // MEASURED boundaries are recorded so the UI can state what the
        // score was computed on. All absent when no window was requested.
        newValidationRowCount: combined.new_validation_row_count ?? null,
        newValidationChecksum: combined.new_validation_checksum ?? null,
        newValidationFrom: combined.new_validation_from ?? null,
        newValidationTo: combined.new_validation_to ?? null,
      },
    ] as unknown as PrismaTypes.InputJsonValue;

    // Deliberately NO `loaderJobs.enqueue` here, unlike Save Dataset's own
    // version create. The loader seam (DS-LAKE-011) hands a version off to
    // the serving-layer sink, which is a consequence of an operator SAVING a
    // dataset. This version is training provenance the retrain minted for
    // itself — publishing it to the serving layer would push data the
    // operator never chose to serve.
    //
    // MODEL-SERVE-015-T06. The combined pair used to be minted outside the
    // DatasetVersion registry entirely, which left it unreachable by every
    // surface that browses a dataset (`listVersionsService` reads version
    // rows only). Registering it here — in the SAME transaction that mints
    // the artifacts — is what makes the combined data explorable, and is
    // also what puts its row count on a readable surface (MODEL-SERVE-015-T05).
    const mint = async (): Promise<string> =>
      this.prisma.$transaction(async (tx) => {
        await tx.datasetArtifact.create({
          data: {
            id: combinedGoldArtifactId,
            datasetId: ctx.baseFinal.datasetId,
            runId: sharedRunId,
            parentArtifactId: ctx.baseFinal.id,
            type: 'GOLD',
            objectKey: combined.object_key,
            checksum: combined.checksum,
            rowCount: combined.row_count,
            columnCount: combined.column_count,
            missingPct: combined.missing_pct,
            sizeBytes: BigInt(combined.size_bytes),
            operations,
            columnStatsKey: combined.column_stats_key ?? null,
            featureSpecKey: combined.feature_spec_key ?? null,
            validationRowCount: combined.validation_row_count ?? null,
            validationHoldoutFrom: combined.validation_holdout_from
              ? new Date(combined.validation_holdout_from)
              : null,
            validationMissingPct: combined.validation_missing_pct ?? null,
            droppedBadRows: combined.dropped_bad_rows ?? null,
            // MODEL-SERVE-015-T04. The one row this whole feature exists to
            // set — see the column's own schema comment.
            validationAlreadyScaled: true,
            createdById: user.id,
          },
        });
        // FINAL by pointer, never a byte copy — same discipline
        // `promoteDraftArtifactToFinalService` documents on its own row.
        // Deliberately no `/validate` re-run here (plan decision): both
        // sources were already validated PASS as their own FINALs.
        await tx.datasetArtifact.create({
          data: {
            id: combinedFinalArtifactId,
            datasetId: ctx.baseFinal.datasetId,
            runId: sharedRunId,
            parentArtifactId: combinedGoldArtifactId,
            type: 'FINAL',
            objectKey: combined.object_key,
            checksum: combined.checksum,
            rowCount: combined.row_count,
            columnCount: combined.column_count,
            missingPct: combined.missing_pct,
            sizeBytes: BigInt(combined.size_bytes),
            operations: [],
            columnStatsKey: combined.column_stats_key ?? null,
            featureSpecKey: combined.feature_spec_key ?? null,
            createdById: user.id,
          },
        });

        // Version numbering read INSIDE the tx, mirroring the canonical Save
        // path (`dataset-draft.authorized.service.ts`). `@@unique([datasetId,
        // versionNumber])` is the backstop; the P2002 retry below is what
        // keeps a concurrent Save on the base dataset from failing a retrain.
        const last = await tx.datasetVersion.findFirst({
          where: { datasetId: ctx.baseFinal.datasetId! },
          orderBy: { versionNumber: 'desc' },
          select: { versionNumber: true },
        });
        const versionNumber = (last?.versionNumber ?? 0) + 1;

        const version = await tx.datasetVersion.create({
          data: {
            datasetId: ctx.baseFinal.datasetId!,
            versionNumber,
            // The ONLY marker of "this version is combined" that a client can
            // read: `listVersionsService` does not select `lineage`, so the
            // suffix on `semanticVersion` is what the retrain picker filters
            // on to stop augmented output compounding into the next retrain.
            semanticVersion: `${versionNumber}.0.0${AUGMENTED_VERSION_SUFFIX}`,
            // Versions always point at the FINAL artifact in this codebase.
            artifactId: combinedFinalArtifactId,
            checksum: combined.checksum,
            columnCount: combined.column_count,
            rowCount: combined.row_count,
            missingPct: combined.missing_pct,
            sizeBytes: BigInt(combined.size_bytes),
            // No `/validate` re-run happens on this path, so there is no
            // report to source `featureCount`/`qualityScore`/
            // `validationAdvisory` from. They stay at their defaults/null
            // rather than being invented — a fabricated quality score on a
            // real training artifact is worse than an absent one, and the
            // versions list renders these as "—".
            status: 'DRAFT',
            lineage: {
              strategy: 'AUGMENT_DATA',
              baseArtifactId: ctx.baseFinal.id,
              baseDatasetVersionId: ctx.baseDatasetVersionId,
              newArtifactId: ctx.newFinal.id,
              newDatasetVersionId: ctx.newDatasetVersionId,
              combinedGoldArtifactId,
              baseTrainRowCount: combined.base_train_row_count,
              newTrainRowCount: combined.new_train_row_count,
              dedupeDropped: combined.dedupe_dropped,
              cutTimestamp: ctx.cutTimestamp,
            },
            createdById: user.id,
          },
          select: { id: true },
        });

        return version.id;
      });

    let combinedDatasetVersionId: string;
    try {
      combinedDatasetVersionId = await mint();
    } catch (err) {
      // A concurrent Save on the base dataset can take the versionNumber
      // between our read and our write. Retry once with a fresh read rather
      // than surfacing the Save path's "another save is in progress" 409,
      // which would be a misleading message for a retrain.
      if (!this.isUniqueViolation(err)) throw err;
      try {
        combinedDatasetVersionId = await mint();
      } catch (retryErr) {
        if (!this.isUniqueViolation(retryErr)) throw retryErr;
        throw new AppException({
          statusCode: 409,
          message:
            'Could not register the combined dataset version — the base ' +
            'dataset is being saved or versioned concurrently. Retry the ' +
            'retrain.',
          type: 'ERROR',
        });
      }
    }

    return {
      combinedFinalArtifactId,
      combinedGoldArtifactId,
      combinedObjectKey: combined.object_key,
      combinedChecksum: combined.checksum,
      combinedFeatureSpecKey: combined.feature_spec_key ?? null,
      combinedRowCount: combined.row_count,
      combinedDatasetVersionId,
    };
  }
}

interface AugmentContext {
  baseFinal: PrismaModels.DatasetArtifactModel;
  baseDatasetVersionId: string | null;
  newFinal: PrismaModels.DatasetArtifactModel;
  newSource: PrismaModels.DatasetArtifactModel;
  newDatasetVersionId: string;
  featureSpecKey: string;
  targetY: string;
  cutTimestamp: string;
  /**
   * The operator's NEW-DATA validation window, when one was requested.
   * Both bounds or neither. Rows inside it are held out of training and
   * scored separately; the frozen incumbent-test slice that `rmseDelta`
   * depends on is untouched.
   */
  newValidationFrom?: string;
  newValidationTo?: string;
}
