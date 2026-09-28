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
  VALIDATE_NEW_DATA_FILENAME,
  VALIDATE_NEW_READY_FILENAME,
  VALIDATE_READY_FILENAME,
} from '@/lib/artifact-keys';
import {
  presignArtifact,
  presignRunObject,
  PresignedArtifact,
  presignModelRunUpload,
  passthroughHoldoutForRun,
  prepareHoldoutForRun,
  replayHoldoutForRun,
  runPredictions,
  getRunManifest,
} from '@/lib/python-preprocess-client';
import {
  hasReferenceResidualSd,
  RESIDUAL_SD_METRIC_KEY,
} from '@/lib/model-version-residual-sd';
import { buildRunKey, resolveRunOwner, RunOwner } from '@/lib/model-run-owner';
import {
  findHoldoutArtifact,
  readNewDataValidationWindow,
} from '@/lib/holdout-artifact';
import { RunCompleteDto } from './dto/model-run.authorized.dto';
import { ModelCandidateJobAuthorizedService } from './model-candidate-job.authorized.service';

/**
 * MODEL-SERVE-021. `claim()` spreads exactly ONE of these two methods'
 * results (`tryReplayHoldout` or `prepareNewDataOnlyComparison`, chosen by
 * `job.retrainStrategy`) into its response. Both return types MUST be this
 * SAME interface — not two structurally different object types unioned —
 * or `claim()`'s inferred return type becomes a union of the whole response
 * object rather than one shape with optional fields, and every field access
 * on the result (this file's own callers, and every test) starts failing to
 * typecheck for whichever branch that field is not literally present on.
 */
interface ClaimHoldoutFields {
  holdoutDataUrl?: string;
  holdoutArtifactChecksum?: string;
  holdoutRowCount?: number;
  holdoutDroppedBadRows?: number | null;
  newDataHoldoutUrl?: string | null;
  newDataHoldoutChecksum?: string | null;
  newDataHoldoutRowCount?: number | null;
  incumbentModelUrl?: string | null;
  incumbentModelChecksum?: string | null;
  incumbentFeatureColumns?: string[] | null;
}

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
  ): Promise<ClaimHoldoutFields | null> {
    if (!run.featureSpecKey) return null;

    // MODEL-FLOW-016-T07. Lookup extracted to a shared lib — the scoring
    // trigger needs the SAME existence check, cheaply, before spawning a
    // container (see model-run-score.authorized.service.ts).
    const holdoutArtifact = await findHoldoutArtifact(
      this.prisma,
      run.goldArtifactId,
    );
    if (!holdoutArtifact) return null;

    // Read once, up front: both the claim-time persistence below and the
    // second-holdout preparation further down need it, and it is a pure
    // read of an already-fetched JSON column.
    const newDataWindow = readNewDataValidationWindow(
      holdoutArtifact.operations,
    );

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
      // function's own module doc). Null for a BRONZE (legacy) holdout, and
      // for a passthrough one (MODEL-SERVE-015-T04 — nothing is dropped
      // because nothing is transformed).
      let holdoutDroppedBadRows: number | null = null;
      if (holdoutArtifact.validationAlreadyScaled) {
        // MODEL-SERVE-015-T04. A retrain-augmentation combined GOLD's
        // frozen-eval slice — already feature-engineered AND scaled, cut
        // straight out of the incumbent's own already-scaled base FINAL.
        // Routing it through `prepareHoldoutForRun`'s `to_model_ready`
        // would double-scale it (checked and ruled out — see this
        // feature's own design note), so this copies it verbatim instead.
        await passthroughHoldoutForRun(commonInput);
      } else if (holdoutArtifact.type === 'BRONZE') {
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

      // MODEL-SERVE-015-T04. Persisted here, not derived later: this is the
      // one place that already knows WHICH holdout shape this run actually
      // scored against, and `buildComparison`
      // (model-retrain.authorized.service.ts) has no other way to tell a
      // plain dataset holdout from an augmented retrain's frozen-incumbent-
      // test slice. Best-effort — inside the SAME soft-fail try/catch as
      // the rest of this method: a write failure here degrades to "not
      // comparable" on read (buildComparison sees evalSetKind stay null),
      // never to a false claim of comparability.
      await this.prisma.modelTrainingRun.update({
        where: { id: run.id },
        data: {
          evalSetKind: holdoutArtifact.validationAlreadyScaled
            ? 'FROZEN_INCUMBENT_TEST'
            : 'DATASET_HOLDOUT',
          frozenEvalChecksum: holdoutArtifact.validationAlreadyScaled
            ? holdoutPresigned.checksum
            : null,
          // The window's own facts, recorded on the run so the retrain UI
          // can state what the new-data figure was computed on without
          // re-reading the artifact's operations blob. The METRIC itself
          // arrives later, from the trainer, through complete().
          newDataHoldoutRowCount: newDataWindow?.rowCount ?? null,
          newDataHoldoutFrom: newDataWindow?.from ?? null,
          newDataHoldoutTo: newDataWindow?.to ?? null,
        },
      });

      // The SECOND holdout, when an augmented retrain carved an operator-
      // defined window out of the new dataset. Prepared in its OWN nested
      // try/catch so a failure here can never cost the run its frozen-eval
      // score: that one is the comparability basis this whole retrain
      // comparison rests on, this one is a supplementary figure, and they
      // must not share a failure mode.
      let newDataHoldout: {
        url: string;
        checksum: string;
        rowCount: number;
      } | null = null;
      try {
        if (newDataWindow) {
          const newDataSourceKey = sidecarKey(
            holdoutArtifact.objectKey,
            VALIDATE_NEW_DATA_FILENAME,
          );
          const newDataTargetKey = buildRunKey(
            owner,
            run.id,
            VALIDATE_NEW_READY_FILENAME,
          );
          // Already model-ready — it was cut from the same scaled frame the
          // training rows came from — so it takes the passthrough path for
          // exactly the reason the frozen slice does: transforming it again
          // would double-scale it.
          await passthroughHoldoutForRun({
            source_key: newDataSourceKey,
            target_key: newDataTargetKey,
            overwrite: true,
          });
          const presigned = await presignRunObject({
            source_key: newDataTargetKey,
          });
          if (presigned.row_count != null) {
            newDataHoldout = {
              url: presigned.data_url,
              checksum: presigned.checksum,
              rowCount: presigned.row_count,
            };
          }
        }
      } catch (err) {
        this.log.warn(
          `New-data holdout preparation skipped for run ${run.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      return {
        holdoutDataUrl: holdoutPresigned.data_url,
        holdoutArtifactChecksum: holdoutPresigned.checksum,
        holdoutRowCount: holdoutPresigned.row_count,
        holdoutDroppedBadRows,
        newDataHoldoutUrl: newDataHoldout?.url ?? null,
        newDataHoldoutChecksum: newDataHoldout?.checksum ?? null,
        newDataHoldoutRowCount: newDataHoldout?.rowCount ?? null,
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
  /**
   * MODEL-SERVE-021. The comparison mechanism for a NEW_DATA_ONLY (replace)
   * candidate — reversing MODEL-SERVE-017's frozen-slice comparison, which
   * `combine_for_retrain` no longer carves for this strategy at all (see
   * that function's own docstring). Comparability instead comes from
   * scoring BOTH the candidate and the incumbent's own saved model on the
   * SAME operator-defined validation window, inside the candidate's own
   * training container — never by mutating the incumbent's own saved run.
   *
   * Deliberately NOT routed through `tryReplayHoldout`/`findHoldoutArtifact`:
   * that resolver's own WHERE clause requires `validationRowCount: { not:
   * null }`, and this strategy's combined GOLD always has it `null` (no
   * frozen slice) — the resolver would correctly find nothing, and correctly
   * so, since there is no frozen slice to find. The window's own facts
   * instead come straight off the combined GOLD's `operations[0]`, read by
   * following the run's own `goldArtifactId` (the combined FINAL) up to its
   * `parentArtifactId` (the combined GOLD) — the same hop
   * `buildComparison`'s own MODEL-SERVE-020-T01 fix reads.
   *
   * Best-effort end to end: any failure here logs and returns `null` rather
   * than failing the run — a candidate that trains successfully must never
   * be lost over a comparison that could not be prepared.
   */
  private async prepareNewDataOnlyComparison(
    run: {
      id: string;
      goldArtifactId: string;
      goldObjectKey: string;
      featureSpecKey: string | null;
    },
    owner: RunOwner,
    incumbentVersionId: string | null,
  ): Promise<ClaimHoldoutFields | null> {
    if (!run.featureSpecKey) return null;

    try {
      const final = await this.prisma.datasetArtifact.findUnique({
        where: { id: run.goldArtifactId },
        select: { parentArtifactId: true },
      });
      const gold = final?.parentArtifactId
        ? await this.prisma.datasetArtifact.findUnique({
            where: { id: final.parentArtifactId },
            select: { operations: true },
          })
        : null;
      const window = readNewDataValidationWindow(gold?.operations ?? null);
      if (!window) {
        // The DTO refuses a NEW_DATA_ONLY trigger with no window at all —
        // reaching here with none means the artifact write itself never
        // recorded it (a bug elsewhere), not an operator omission. Either
        // way there is nothing to score, so no comparison is possible.
        await this.appendLog(run.id, {
          level: 'warn',
          message:
            'New Data Only comparison skipped: the combined artifact ' +
            'recorded no validation window.',
        });
        return null;
      }

      const sourceKey = sidecarKey(
        run.goldObjectKey,
        VALIDATE_NEW_DATA_FILENAME,
      );
      const targetKey = buildRunKey(owner, run.id, VALIDATE_NEW_READY_FILENAME);
      // Already model-ready (scaled with the base's pinned params at combine
      // time) — a straight copy into the run's own prefix, never a re-scale.
      await passthroughHoldoutForRun({
        source_key: sourceKey,
        target_key: targetKey,
        overwrite: true,
      });
      const presigned = await presignRunObject({ source_key: targetKey });

      // MODEL-SERVE-021. The CURRENT PRODUCTION model, scored by the SAME
      // container on the SAME window — never a different container, never a
      // number pulled from the incumbent's own saved (old) test split, and
      // never written back to the incumbent's own row.
      let incumbent: {
        url: string;
        checksum: string;
        featureColumns: string[];
      } | null = null;
      if (incumbentVersionId) {
        try {
          const version = await this.prisma.modelVersion.findUnique({
            where: { id: incumbentVersionId },
            select: {
              modelObjectKey: true,
              modelChecksum: true,
              algorithm: true,
              sourceRunId: true,
            },
          });
          // lstm/gru score a WINDOW of rows per prediction, and the window
          // length is recorded nowhere this layer can read (the manifest
          // carries feature_columns, not sequence_length) — scoring them
          // correctly needs that number, so they are skipped rather than
          // scored with a guessed one. The candidate's own figures are
          // unaffected; only the incumbent side of this one comparison is
          // absent, with a stated reason.
          if (
            version?.modelObjectKey &&
            version.algorithm !== 'lstm' &&
            version.algorithm !== 'gru'
          ) {
            const modelPresigned = await presignRunObject({
              source_key: version.modelObjectKey,
            });
            const sourceRun = version.sourceRunId
              ? await this.prisma.modelTrainingRun.findUnique({
                  where: { id: version.sourceRunId },
                  select: { manifestKey: true },
                })
              : null;
            const manifest = sourceRun?.manifestKey
              ? await getRunManifest(sourceRun.manifestKey)
              : null;
            if (manifest?.feature_columns?.length) {
              incumbent = {
                url: modelPresigned.data_url,
                checksum: version.modelChecksum ?? modelPresigned.checksum,
                featureColumns: manifest.feature_columns,
              };
            } else {
              await this.appendLog(run.id, {
                level: 'warn',
                message:
                  'Current version comparison skipped: its run manifest ' +
                  'records no feature_columns (trained before that field ' +
                  'existed).',
              });
            }
          } else if (
            version &&
            (version.algorithm === 'lstm' || version.algorithm === 'gru')
          ) {
            await this.appendLog(run.id, {
              level: 'warn',
              message:
                `Current version comparison skipped: ${version.algorithm} ` +
                'scores a window of rows per prediction, and this feature ' +
                'does not yet resolve the window length needed to do that ' +
                'correctly.',
            });
          }
        } catch (err) {
          await this.appendLog(run.id, {
            level: 'warn',
            message:
              'Current version comparison skipped: ' +
              (err instanceof Error ? err.message : String(err)),
          });
        }
      }

      // MODEL-SERVE-021. Persisted here, mirroring `tryReplayHoldout`'s own
      // "persisted here, not derived later" comment above: this is the one
      // place that already knows the window's real bounds, and
      // `buildComparison` has no other way to label the figure — its basis
      // reads these three columns off the run, never the artifact's
      // operations blob directly. Missing this write is exactly the kind of
      // gap that leaves a real comparison unlabeled (019's own rule).
      await this.prisma.modelTrainingRun.update({
        where: { id: run.id },
        data: {
          newDataHoldoutRowCount: presigned.row_count ?? window.rowCount,
          newDataHoldoutFrom: window.from,
          newDataHoldoutTo: window.to,
        },
      });

      return {
        newDataHoldoutUrl: presigned.data_url,
        newDataHoldoutChecksum: presigned.checksum,
        newDataHoldoutRowCount: presigned.row_count ?? window.rowCount,
        incumbentModelUrl: incumbent?.url ?? null,
        incumbentModelChecksum: incumbent?.checksum ?? null,
        incumbentFeatureColumns: incumbent?.featureColumns ?? null,
      };
    } catch (err) {
      await this.appendLog(run.id, {
        level: 'warn',
        message:
          `New Data Only comparison setup skipped for run ${run.id}: ` +
          (err instanceof Error ? err.message : String(err)),
      });
      return null;
    }
  }

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
    // MODEL-SERVE-021. A NEW_DATA_ONLY (replace) candidate takes a WHOLLY
    // DIFFERENT comparison path — see `prepareNewDataOnlyComparison`'s own
    // comment for why `tryReplayHoldout` (which requires a frozen slice this
    // strategy no longer carves) cannot be reused for it.
    const job = run.candidateJobId
      ? await this.prisma.modelCandidateJob.findUnique({
          where: { id: run.candidateJobId },
          select: { retrainStrategy: true, sourceVersionId: true },
        })
      : null;
    const holdout = isCvRun
      ? null
      : job?.retrainStrategy === 'NEW_DATA_ONLY'
        ? await this.prepareNewDataOnlyComparison(
            run,
            owner,
            job.sourceVersionId,
          )
        : await this.tryReplayHoldout(run, owner);

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
      // MODEL-SERVE-007-T06. Both exist so run_manifest.json can describe
      // itself without a resolver. `goldBucket` comes from the presign
      // response because python is the only component that knows the bucket
      // name — `goldObjectKey` above is a key RELATIVE to it, never a
      // location on its own. `goldArtifactId` is read off the ROW even
      // though it is also a segment inside the key: a reference parsed out
      // of a path breaks when the path shape changes, a field does not.
      goldBucket: presigned.bucket,
      goldArtifactId: run.goldArtifactId,
      dataUrl: presigned.data_url,
      featureSpecUrl: presigned.sidecar_urls['feature_spec.json'],
      // MODEL-FLOW-019-T31. Read off the ROW, never from the container's own
      // request body — the same rule `mintUploadUrls` below states for run
      // ids: a container must not be able to choose what it trains on.
      // Undefined for every ordinary run, and the container then derives its
      // own columns exactly as it always has.
      featureColumns: run.featureColumns ?? undefined,
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
      // Scored on the operator's new-data window. Kept apart from
      // `holdoutMetrics` above deliberately — see that column's own schema
      // comment: one is all old rows and underpins the incumbent
      // comparison, this is all new rows and stands on its own.
      newDataHoldoutMetrics: dto.newDataHoldoutMetrics ?? undefined,
      // MODEL-SERVE-021. The current PRODUCTION model's score on that SAME
      // window — see this column's own schema comment for why it is a
      // fourth, never-blended field.
      incumbentNewDataHoldoutMetrics:
        dto.incumbentNewDataHoldoutMetrics ?? undefined,
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
      // MODEL-FLOW-019-T09. null for every algorithm
      // images/trainer/app/importance.py cannot read a real per-feature
      // quantity from — the same null-means-not-applicable discipline
      // lossHistoryKey/cvFoldsKey use above.
      featureImportanceKey: keyIf('feature_importance.json'),
      // MODEL-FLOW-023-T10. null for every run whose strategy does not
      // supply a permutation population — everything except lstm/gru today
      // — the same null-means-not-applicable discipline the sibling keys
      // above use. Re-checked, not assumed: scoreCompleteService's own
      // narrow update (below) writes only predictionsKey/
      // holdoutPredictionsKey/holdoutMetrics with `undefined` for anything
      // absent, so a later scoring phase can never null this key either —
      // the same property MODEL-FLOW-019-T09 verified for
      // featureImportanceKey and MODEL-FLOW-019-T20 preserved when it added
      // holdoutPredictionsKey to that narrower update.
      permutationImportanceKey: keyIf('permutation_importance.json'),
      // MODEL-FLOW-019-T26. The run's own holdout series, written INLINE at
      // training time now that `_score_holdout_if_present` keeps the frame it
      // used to discard. null for a run whose dataset has no holdout, for a
      // CV run (whose holdout still arrives through scoring, in
      // `predictionsKey`), and whenever holdout scoring soft-failed.
      //
      // ORDERING, stated rather than left to be re-derived: `keyIf` writes
      // NULL, not undefined, for anything absent from `uploaded`. That is safe
      // here ONLY because training `complete()` runs exactly once and always
      // BEFORE any scoring — scoring requires a SUCCEEDED run — so this can
      // never null a key the scoring phase wrote. The reverse exposure T09
      // checked still holds and is unaffected: `scoreCompleteService`'s narrow
      // update uses `undefined`, so a re-score cannot null this key either.
      holdoutPredictionsKey: keyIf('holdout_predictions.parquet'),
      // MODEL-SERVE-020-T06. The candidate's per-row series on the operator's
      // new-data window. null for every run with no such window, for a run
      // from before this column, and — the one that bites — for a run trained
      // by a trainer IMAGE that predates it: the artifact is simply never
      // uploaded, `keyIf` records null, and the Retrain tab states an honest
      // absence while every layer of code is correct (see the image-drift
      // note beside TRAINING_IMAGE). Same ordering argument as the key above:
      // training `complete()` runs once, before any scoring.
      newDataHoldoutPredictionsKey: keyIf(
        'new_data_holdout_predictions.parquet',
      ),
      // MODEL-SERVE-021. The current PRODUCTION model's per-row series on
      // that SAME window — same null-means-not-recorded discipline as the
      // key above, and the same ordering argument (complete() runs once,
      // before any scoring).
      incumbentNewDataHoldoutPredictionsKey: keyIf(
        'incumbent_new_data_holdout_predictions.parquet',
      ),
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

    await this.recordReferenceResidualSd(updatedRun);

    return updatedRun;
  }

  /**
   * MODEL-SERVE-012-T02. Record the run's own residual SD on its metrics
   * blob, so live monitoring has a FROZEN reference to grade against
   * (`lib/model-version-residual-sd.ts` explains why a frozen one is the
   * only kind that tests anything).
   *
   * HERE, NOT IN THE TRAINER. The trainer emits r2/rmse/mae only
   * (images/trainer/app/metrics.py) and nothing in CI builds that image, so
   * a trainer-side addition is a silent no-op until someone rebuilds and
   * bumps the tag. The same number is already derivable from the run's own
   * predictions.parquet through python's `run_predictions` (`residual_sd`),
   * which needs no image change and works for historical runs too.
   *
   * HERE, NOT AT SAVE MODEL. Save Model is this system's single atomic
   * commit boundary (CLAUDE.md §13); an HTTP round trip inside it would put
   * a remote failure in the path of the one write that must not half-happen.
   * Written onto the RUN, it reaches the version for free through the
   * existing metrics copy in `lib/model-version-from-run.ts`.
   *
   * BEST EFFORT, exactly like the candidate-job nudge above and for the same
   * reason: the run row is already durable, and a missing reference SD is a
   * state the reader already handles — `baselineResidualSd` falls back to
   * `rmse` (wider, so quieter) and, failing that, the verdict is UNKNOWN.
   * Never a fabricated value, and never a failed response to the container.
   */
  private async recordReferenceResidualSd(run: {
    id: string;
    status: string;
    metrics: unknown;
    manifestKey: string | null;
    predictionsKey: string | null;
  }): Promise<void> {
    if (run.status !== 'SUCCEEDED') return;
    // Nothing to read the pairs from. A closed-form or failed run simply has
    // no reference SD; that is a fact about the run, not an error.
    if (!run.predictionsKey) return;
    // Already carries one — re-scoring must not overwrite the value the
    // model was accepted on.
    if (hasReferenceResidualSd(run.metrics)) return;
    if (!run.metrics || typeof run.metrics !== 'object') return;

    try {
      const predictions = await runPredictions({
        source_key: run.predictionsKey,
        manifest_key: run.manifestKey,
      });
      const sd = predictions.residual_sd;
      if (typeof sd !== 'number' || !Number.isFinite(sd) || sd <= 0) return;

      await this.prisma.modelTrainingRun.update({
        where: { id: run.id },
        data: {
          metrics: {
            ...(run.metrics as Record<string, unknown>),
            [RESIDUAL_SD_METRIC_KEY]: sd,
          },
        },
      });
    } catch (err) {
      this.log.error(
        `could not record reference residual SD for run ${run.id}`,
        err,
      );
    }
  }
}
