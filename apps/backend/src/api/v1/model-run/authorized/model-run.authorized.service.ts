import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@softsensor/prisma';
import {
  sidecarKey,
  VALIDATE_DATA_FILENAME,
  VALIDATE_READY_FILENAME,
} from '@/lib/artifact-keys';
import {
  presignArtifact,
  presignRunObject,
  PresignedArtifact,
  presignModelRunUpload,
  prepareHoldoutForRun,
  replayHoldoutForRun,
} from '@/lib/python-preprocess-client';
import { buildRunKey, resolveRunOwner, RunOwner } from '@/lib/model-run-owner';
import { findHoldoutArtifact } from '@/lib/holdout-artifact';
import { RunCompleteDto } from './dto/model-run.authorized.dto';
import { ModelCandidateJobAuthorizedService } from './model-candidate-job.authorized.service';

@Injectable()
export class ModelRunAuthorizedService {
  private readonly log = new Logger(ModelRunAuthorizedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly candidateJobs: ModelCandidateJobAuthorizedService,
  ) {}

  /**
   * DS-LAKE-018-T05 / DS-LAKE-023-T03/T04. If this run's dataset has a
   * validation holdout, score it and presign the result — this is what
   * wires the replay/prepare endpoints into a real training run.
   *
   * TWO holdout shapes can exist on the same `runId` chain, and they are
   * mutually exclusive per D1 (feature_list.preprocessing.json): a legacy
   * RAW holdout, cut at BRONZE before features ever ran (needs a full
   * recipe REPLAY), or a DS-LAKE-023 FEATURE-BEARING holdout, cut after
   * features ran (needs only the recorded scaler PREPARED, no replay).
   * `pipelineVersion` cannot discriminate these — DS-LAKE-022 already
   * stamps every create-mode SILVER with it regardless of whether a
   * holdout was ever picked. The only reliable signal is WHICH ARTIFACT
   * ROW actually carries a non-null `validationRowCount`.
   *
   * Deliberately SOFT-FAIL: unlike the checksum-drift guard above, a
   * holdout scoring problem must never fail a run that has nothing to do
   * with the holdout mechanism itself — a legacy/no-holdout dataset (the
   * overwhelming majority) must train exactly as it does today. A failure
   * here just means `claim()`'s response omits the holdout fields, and the
   * container skips holdout scoring for this run.
   */
  private async tryReplayHoldout(
    run: {
      id: string;
      datasetId: string;
      goldArtifactId: string;
      featureSpecKey: string | null;
      modelId: string | null;
      modelDraftId: string | null;
    },
    owner: RunOwner,
  ): Promise<{
    holdoutDataUrl: string;
    holdoutArtifactChecksum: string;
    holdoutRowCount: number;
    holdoutDroppedBadRows: number | null;
  } | null> {
    if (!run.featureSpecKey) return null;

    // MODEL-FLOW-016-T07. Lookup extracted to a shared lib — the scoring
    // trigger needs the SAME existence check, cheaply, before spawning a
    // container (see model-run-score.authorized.service.ts).
    const holdoutArtifact = await findHoldoutArtifact(
      this.prisma,
      run.goldArtifactId,
    );
    if (!holdoutArtifact) return null;

    try {
      // Derived from the artifact's own `objectKey` (the key actually
      // written), not rebuilt from `run.datasetId` — a draft-built
      // dataset's artifact lives under `drafts/{draftId}/…`, so rebuilding
      // the prefix from `datasetId` alone produced a key nothing ever
      // wrote and this replay silently skipped (soft-fail below) for
      // every such run.
      const sourceKey = sidecarKey(
        holdoutArtifact.objectKey,
        VALIDATE_DATA_FILENAME,
      );
      const targetKey = buildRunKey(owner, run.id, VALIDATE_READY_FILENAME);
      const commonInput = {
        feature_spec_key: run.featureSpecKey,
        source_key: sourceKey,
        target_key: targetKey,
        // Deterministic per-run key, nothing else ever reads or writes it —
        // unlike GOLD's data.parquet, a second claim() re-scoring is
        // harmless, not a leakage risk.
        overwrite: true,
      };

      // DS-LAKE-023-T05. Only `prepareHoldoutForRun` ever populates
      // `dropped_bad_rows` — the legacy `replayHoldoutForRun` path does not
      // run `drop_bad_feature_rows` (out of this task's scope; see that
      // function's own module doc). Null for a BRONZE (legacy) holdout.
      let holdoutDroppedBadRows: number | null = null;
      if (holdoutArtifact.type === 'BRONZE') {
        // Legacy raw holdout — needs the full recipe replayed, and the
        // resolved boundary to trim lead-in rows afterward.
        if (!holdoutArtifact.validationHoldoutFrom) return null;
        await replayHoldoutForRun({
          ...commonInput,
          holdout_from: holdoutArtifact.validationHoldoutFrom.toISOString(),
        });
      } else {
        // DS-LAKE-023: feature-bearing holdout (SILVER in create mode,
        // GOLD in edit mode — both non-BRONZE) — already has its derived
        // columns and no lead-in to trim, so only the recorded scaler
        // needs applying.
        const prepared = await prepareHoldoutForRun(commonInput);
        holdoutDroppedBadRows = prepared.dropped_bad_rows ?? null;
      }
      // MODEL-FLOW-016-T08. NOT presignArtifact: that call is hard-restricted
      // server-side to is_committed_artifact_key (a committed DATASET
      // artifact's data.parquet) and refuses this run-scoped key outright —
      // confirmed live (2026-09-01) as the reason holdoutMetrics had been
      // null on every run in this system, regardless of whether the dataset
      // actually had a holdout. presignRunObject is the run-scoped read.
      const holdoutPresigned = await presignRunObject({
        source_key: targetKey,
      });
      // presign_run_object only computes row_count for VALIDATE_READY_
      // FILENAME (artifact_service.py) — always a real number for THIS
      // filename. Null here means the object it read was not actually a
      // parquet file, a real anomaly worth failing loudly on (caught by
      // this function's own outer soft-fail try/catch) rather than lying
      // with a fabricated 0.
      if (holdoutPresigned.row_count == null) {
        throw new Error(
          `Presigned holdout object ${targetKey} reported no row_count.`,
        );
      }

      return {
        holdoutDataUrl: holdoutPresigned.data_url,
        holdoutArtifactChecksum: holdoutPresigned.checksum,
        holdoutRowCount: holdoutPresigned.row_count,
        holdoutDroppedBadRows,
      };
    } catch (err) {
      await this.appendLog(run.id, {
        level: 'warn',
        message: `Holdout scoring skipped: ${(err as Error).message}`,
      });
      return null;
    }
  }

  /**
   * MODEL-FLOW-016-T07. PUBLIC entry point for
   * `ModelRunScoreAuthorizedService`'s scoring-claim: the SAME replay/
   * prepare + presign `claim()` uses inline for a non-CV run's holdout,
   * reused here rather than re-implemented, so a CV run's separate scoring
   * phase resolves its holdout through one code path, not two.
   * `tryReplayHoldout` stays private — this is the one door into it from
   * outside this class, same shape as `assertDraftWritable`'s relationship
   * to `assertDraftAccess` in the launch service.
   */
  resolveHoldoutForRun(
    run: {
      id: string;
      datasetId: string;
      goldArtifactId: string;
      featureSpecKey: string | null;
      modelId: string | null;
      modelDraftId: string | null;
    },
    owner: RunOwner,
  ) {
    return this.tryReplayHoldout(run, owner);
  }

  /** Everything the container needs, in one round trip. */
  async claim(runId: string) {
    const run = await this.prisma.modelTrainingRun.findUnique({
      where: { id: runId },
    });
    if (!run) throw new NotFoundException();

    let presigned: PresignedArtifact;
    try {
      presigned = await presignArtifact({
        source_key: run.goldObjectKey,
        sidecars: ['feature_spec.json', 'column_stats.json'],
      });
    } catch (err) {
      await this.prisma.modelTrainingRun.update({
        where: { id: runId },
        data: {
          status: 'FAILED',
          failureReason: `Could not presign artifact: ${(err as Error).message}`,
          finishedAt: new Date(),
          tokenExpiresAt: new Date(0),
        },
      });
      throw err;
    }

    if (presigned.checksum !== run.artifactChecksum) {
      await this.prisma.modelTrainingRun.update({
        where: { id: runId },
        data: {
          status: 'FAILED',
          failureReason:
            `Artifact checksum drift: row says ${run.artifactChecksum}, ` +
            `storage says ${presigned.checksum}.`,
          finishedAt: new Date(),
        },
      });
      throw new BadRequestException(
        'Artifact checksum mismatch — run aborted.',
      );
    }

    const owner = resolveRunOwner(run);
    // MODEL-FLOW-016-T07. A CV run's holdout is scored by the SEPARATE,
    // user-triggered scoring phase (model-run-score.authorized.service.ts),
    // not here — replaying it at claim time too would be a second full
    // replay of the same frame for a run whose training container never
    // reads `holdoutDataUrl` in the first place (train.py's step 9b is
    // gated `and not is_cv`). `splitSpec` is untyped Json on the row; the
    // discriminant is the same `method` field the DTO's discriminated union
    // switches on.
    const isCvRun =
      (run.splitSpec as { method?: string } | null)?.method === 'cv_expanding';
    const holdout = isCvRun ? null : await this.tryReplayHoldout(run, owner);

    return {
      runId: run.id,
      targetY: run.targetY,
      algorithm: run.algorithm,
      hyperparameters: run.hyperparameters,
      seed: run.seed,
      splitSpec: run.splitSpec,
      artifactChecksum: run.artifactChecksum,
      imageDigest: run.imageDigest,
      goldObjectKey: run.goldObjectKey,
      dataUrl: presigned.data_url,
      featureSpecUrl: presigned.sidecar_urls['feature_spec.json'],
      rowCount: presigned.row_count,
      ...(holdout ?? {}),
    };
  }

  appendLog(runId: string, dto: { level?: string; message: string }) {
    return this.prisma.modelTrainingRunLog.create({
      data: {
        runId,
        level: dto.level ?? 'info',
        message: dto.message.slice(0, 4000),
      },
    });
  }

  async mintUploadUrls(runId: string, filenames: string[]) {
    const run = await this.prisma.modelTrainingRun.findUnique({
      where: { id: runId },
    });
    if (!run) throw new NotFoundException();
    // Ids come from the ROW, never from the container's request body — a
    // container must not be able to choose which run's prefix it writes to.
    const owner = resolveRunOwner(run);
    return presignModelRunUpload(
      owner.scope === 'draft'
        ? { draft_id: owner.id, run_id: run.id, filenames }
        : { model_id: owner.id, run_id: run.id, filenames },
    );
  }

  async complete(runId: string, dto: RunCompleteDto) {
    const run = await this.prisma.modelTrainingRun.findUnique({
      where: { id: runId },
    });
    if (!run) throw new NotFoundException();

    const uploaded = new Set(dto.uploaded ?? []);
    const owner = resolveRunOwner(run);
    const keyIf = (f: string) =>
      uploaded.has(f) ? buildRunKey(owner, run.id, f) : null;

    const data = {
      status: dto.status,
      failureReason: dto.failureReason ?? null,
      metrics: dto.metrics ?? undefined,
      // DS-LAKE-018-T05. Same shape as metrics, scored on the replayed raw
      // holdout — a SEPARATE column, never merged into metrics above.
      holdoutMetrics: dto.holdoutMetrics ?? undefined,
      splitSpec: dto.splitSpec,
      modelKey: keyIf('model.joblib'),
      metricsKey: keyIf('metrics.json'),
      manifestKey: keyIf('run_manifest.json'),
      predictionsKey: keyIf('predictions.parquet'),
      // MODEL-FLOW-013-T05. null (not undefined) when absent from
      // `uploaded` — a closed-form algorithm's run never uploads this file,
      // and the client's render-mode choice (T05a) keys off this column
      // being null vs. set, never off the algorithm name.
      lossHistoryKey: keyIf('loss_history.json'),
      // MODEL-FLOW-016-T04. null for every non-CV run — the same
      // null-means-not-applicable discipline lossHistoryKey uses above.
      cvFoldsKey: keyIf('cv_folds.json'),
      finishedAt: new Date(),
      // Close the token with the run. Nothing legitimate needs it after
      // this point.
      tokenExpiresAt: new Date(0),
    };

    // A successful draft-scoped run flips its owning draft to TRAINED
    // (MODEL-FLOW-003-T07) in the same transaction as the run update — a
    // reader must never observe a SUCCEEDED run against a still-ACTIVE
    // draft. NOT for a candidate-job run (MODEL-FLOW-005, generalized by
    // MODEL-FLOW-013): an intermediate candidate finishing must not
    // overwrite currentRunId with itself — only the JOB'S winner should
    // ever end up there, and only `advanceJobForRun` (below) decides which
    // run that is, once every candidate has been tried.
    const updatedRun =
      owner.scope === 'draft' &&
      dto.status === 'SUCCEEDED' &&
      !run.candidateJobId
        ? (
            await this.prisma.$transaction([
              this.prisma.modelTrainingRun.update({
                where: { id: runId },
                data,
                omit: { tokenHash: true },
              }),
              this.prisma.modelDraft.update({
                where: { id: owner.id },
                data: { status: 'TRAINED', currentRunId: runId },
              }),
            ])
          )[0]
        : await this.prisma.modelTrainingRun.update({
            where: { id: runId },
            data,
            omit: { tokenHash: true },
          });

    // MODEL-FLOW-005, generalized by MODEL-FLOW-013: best-effort nudge — a
    // candidate-job run that just reached a terminal status advances (or
    // fails) its job immediately, rather than waiting for the next read to
    // reconcile it (`getJobService`'s own doc comment covers that slower
    // path). Never allowed to fail the container's response: the run row
    // above is already durable regardless of what happens here, and
    // `advanceJobForRun` is idempotent, so a failure here just means the
    // reconcile-on-read path picks it up instead.
    if (run.candidateJobId) {
      try {
        await this.candidateJobs.advanceJobForRun(runId, run.candidateJobId);
      } catch (err) {
        this.log.error(
          `candidate-job nudge failed for run ${runId} (job ${run.candidateJobId})`,
          err,
        );
      }
    }

    return updatedRun;
  }
}
