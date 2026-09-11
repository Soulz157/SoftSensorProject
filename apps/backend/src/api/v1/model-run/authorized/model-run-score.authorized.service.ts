import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@softsensor/prisma';
import {
  presignRunObject,
  getRunManifest,
} from '@/lib/python-preprocess-client';
import { buildRunKey, resolveRunOwner } from '@/lib/model-run-owner';
import { findHoldoutArtifact } from '@/lib/holdout-artifact';
import { mintRunToken } from '@/lib/mint-run-token';
import { TrainningContainerAuthorizedService } from '../../trainning-container/authorized/trainning-container.authorized.service';
import { ModelRunAuthorizedService } from './model-run.authorized.service';
import { ModelRunLaunchAuthorizedService } from './model-run-launch.authorized.service';
import { ScoreCompleteDto } from './dto/model-run.authorized.dto';

/** predictions.parquet — the one filename a CV run's scoring ever uploads
 *  (it has no test split to lose). Matches `complete()`'s own literal
 *  (RUN_UPLOAD_FILENAMES has no dedicated constant for this filename
 *  either). */
const PREDICTIONS_FILENAME = 'predictions.parquet';
/** MODEL-FLOW-019-T20. The one filename a NON-CV run's scoring uploads —
 *  never PREDICTIONS_FILENAME, which already holds that run's own TEST
 *  split the moment training finishes. See artifact-keys.ts and
 *  images/trainer/app/MIRRORS.md entry 8. */
const HOLDOUT_PREDICTIONS_FILENAME = 'holdout_predictions.parquet';

/**
 * Much shorter than training's RUN_TOKEN_TTL_MS (12h): scoring is a
 * predict-only pass over an already-fitted model against one holdout
 * frame, not a fit.
 */
const SCORE_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * MODEL-FLOW-016-T07. Holdout scoring as its own, user-triggered phase.
 *
 * A CV run's `model.joblib` is the refit-on-everything model — its fold
 * metrics (`cv_folds.json`) describe the CONFIGURATION, not that specific
 * artifact, and unlike a non-CV run, `claim()` never scores this model
 * against the dataset's raw validation holdout (see that method's own
 * `isCvRun` gate). This service is the separate path that does.
 *
 * MODEL-FLOW-019-T20. WIDENED to non-CV runs, by explicit user decision.
 * A non-CV run's `claim()` already computes an inline holdout AGGREGATE
 * (`_score_holdout_if_present` in images/trainer/app/pipelines/__init__.py)
 * but discards the per-row frame — this path is now how that per-row
 * series gets produced and persisted for a non-CV run too, on demand. The
 * two run kinds diverge only in WHICH filename `score.py` uploads
 * (`isCvRun` in `scoreClaimService`'s response) and which column
 * `scoreCompleteService` writes it to — never in whether scoring is
 * allowed.
 *
 * DELIBERATELY three new endpoints, not a re-entry of the training path:
 * `claim()` returns a training spec (dataUrl/algorithm/hyperparameters),
 * not what a scoring container needs (model.joblib + validate_ready URLs);
 * the training token is already dead by the time a SUCCEEDED run's
 * scoring is triggered (`complete()` zeroes `tokenExpiresAt`); and
 * `complete()` flips the owning draft to TRAINED and nudges candidate
 * jobs, neither of which a re-score may ever repeat. See `ScoreTokenGuard`
 * for how the shared `tokenHash`/`tokenExpiresAt` columns stay safe to
 * reuse despite that.
 */
@Injectable()
export class ModelRunScoreAuthorizedService {
  private readonly log = new Logger(ModelRunScoreAuthorizedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly runs: ModelRunAuthorizedService,
    private readonly launch: ModelRunLaunchAuthorizedService,
    private readonly runner: TrainningContainerAuthorizedService,
  ) {}

  /**
   * USER-facing. Draft-scoped only (see this method's own file-level doc):
   * scoring is surfaced from Step 3 Evaluation, before Save Model ever
   * adopts a run onto a Model — the same lifecycle window
   * `getDraftRunPredictionsService` already reads from.
   */
  async triggerScoringService(
    draftId: string,
    runId: string,
    userId: string,
    role: string,
  ) {
    await this.launch.assertDraftWritable(draftId, userId, role);

    const run = await this.prisma.modelTrainingRun.findFirst({
      where: { id: runId, modelDraftId: draftId },
      omit: { tokenHash: true },
    });
    if (!run) throw new NotFoundException();

    if (run.status !== 'SUCCEEDED') {
      throw new BadRequestException(
        `Run ${runId} is ${run.status.toLowerCase()} — holdout scoring ` +
          'needs a SUCCEEDED run.',
      );
    }
    if (run.scoringContainerId) {
      throw new BadRequestException(`Run ${runId} is already being scored.`);
    }
    // MODEL-FLOW-019-T29. Score-mode has no windowing path — score.py calls
    // score_holdout with no sequence_length (images/trainer/app/pipelines/
    // score.py, justified there as "CV is TABULAR ONLY"), which takes
    // holdout.py's TABULAR branch. Training's own inline pass took the
    // WINDOWED branch for these two algorithms
    // (result.holdout_sequence_length, pipelines/__init__.py) — the two
    // branches write row_count/dropped_unlabelled in different units
    // (windows vs rows, holdout.py's own comment), so a backfill against a
    // sequence run would either fail loudly or write a mismatched pair
    // over the aggregate training already recorded. Same convention as
    // this module's own CV/sequence refusal (model-run-launch
    // .authorized.service.ts's config-time lstm/gru check).
    if (run.algorithm === 'lstm' || run.algorithm === 'gru') {
      throw new BadRequestException(
        `Run ${runId} trained ${run.algorithm}, and holdout scoring has ` +
          'no windowing path — it would score the sequence model as if ' +
          'every row were independent. Not available for this algorithm.',
      );
    }
    if (!run.featureSpecKey || !run.modelKey) {
      throw new BadRequestException(
        `Run ${runId} is missing its feature spec or model artifact — ` +
          'cannot score.',
      );
    }

    // Cheap existence check — the full replay/prepare happens once, at
    // scoring-claim time (ModelRunAuthorizedService.resolveHoldoutForRun),
    // not here. Refusing before a container ever spawns mirrors V06's own
    // requirement for CV training itself, extended to this phase.
    const holdoutArtifact = await findHoldoutArtifact(
      this.prisma,
      run.goldArtifactId,
    );
    if (!holdoutArtifact) {
      throw new BadRequestException(
        `Dataset for run ${runId} has no validation holdout — nothing to ` +
          'score against.',
      );
    }

    const { token, tokenHash } = mintRunToken();
    await this.prisma.modelTrainingRun.update({
      where: { id: runId },
      data: {
        tokenHash,
        tokenExpiresAt: new Date(Date.now() + SCORE_TOKEN_TTL_MS),
      },
    });

    await this.runner.spawn(runId, token, 'score');

    return {
      statusCode: 200,
      message: 'Holdout scoring started',
      type: 'SUCCESS' as const,
      data: { runId, scoring: true },
    };
  }

  /** CONTAINER-facing. Thin passthrough to the existing, owner-agnostic
   *  log append `claim()`'s container also uses. */
  scoreLogService(runId: string, dto: { level?: string; message: string }) {
    return this.runs.appendLog(runId, dto);
  }

  /** CONTAINER-facing. Everything a scoring container needs, in one round
   *  trip — mirrors `claim()`'s own shape for training. */
  async scoreClaimService(runId: string) {
    const run = await this.prisma.modelTrainingRun.findUnique({
      where: { id: runId },
    });
    if (!run) throw new NotFoundException();
    if (!run.modelKey) {
      throw new BadRequestException(
        `Run ${runId} has no recorded model.joblib — cannot score.`,
      );
    }

    const modelPresigned = await presignRunObject({
      source_key: run.modelKey,
    });

    const owner = resolveRunOwner(run);
    const holdout = await this.runs.resolveHoldoutForRun(run, owner);
    if (!holdout) {
      // Unlike claim()'s own inline call — where a missing holdout is a
      // legitimate "this dataset has none" for the many non-CV runs — a
      // scoring phase reaching this point already passed
      // triggerScoringService's existence check. A holdout gone missing
      // between trigger and claim is a real failure, not a quiet skip:
      // fail the scoring phase loudly.
      throw new BadRequestException(
        `Run ${runId}'s holdout could not be resolved at scoring-claim ` +
          'time even though it was present when scoring was triggered — ' +
          'see the run log for the underlying replay/prepare error.',
      );
    }

    // The exact columns, in the exact order, model.predict expects — no DB
    // column carries this (MODEL-FLOW-016-T07's RunManifestSchema addition).
    // Absent or empty is a hard refusal here: a scoring container that
    // predicted against the WRONG column set would produce a plausible but
    // silently wrong holdout score, worse than refusing outright.
    const manifest = run.manifestKey
      ? await getRunManifest(run.manifestKey)
      : null;
    const featureColumns = manifest?.feature_columns ?? null;
    if (!featureColumns || featureColumns.length === 0) {
      throw new BadRequestException(
        `Run ${runId} has no recorded feature_columns in its manifest — ` +
          'its training image predates MODEL-FLOW-016-T07. Cannot score.',
      );
    }

    return {
      runId: run.id,
      targetY: run.targetY,
      imageDigest: run.imageDigest,
      // MODEL-FLOW-019-T20. Tells score.py which filename to upload —
      // PREDICTIONS_FILENAME for a CV run (no test split to lose),
      // HOLDOUT_PREDICTIONS_FILENAME otherwise. The container has no other
      // way to know: cvFoldsKey itself is never sent to it.
      isCvRun: Boolean(run.cvFoldsKey),
      modelUrl: modelPresigned.data_url,
      modelChecksum: modelPresigned.checksum,
      featureColumns,
      holdoutDataUrl: holdout.holdoutDataUrl,
      holdoutArtifactChecksum: holdout.holdoutArtifactChecksum,
      holdoutRowCount: holdout.holdoutRowCount,
      holdoutDroppedBadRows: holdout.holdoutDroppedBadRows,
    };
  }

  /**
   * CONTAINER-facing. `mintUploadUrls` itself is owner-agnostic and has no
   * `status`/filename gate of its own (only the controller's guard chose
   * WHICH caller can reach it) — reusing it directly under
   * `ScoreTokenGuard` is safe ONLY because of the allowlist below.
   * `RunUploadUrlsDto`'s `filenames` accepts the FULL RUN_UPLOAD_FILENAMES
   * list (model.joblib, metrics.json, run_manifest.json, cv_folds.json,
   * …) — without this check a scoring container could mint a write URL
   * for any of them and overwrite the training run's own recorded
   * artifacts, contradicting `scoreCompleteService`'s own stated
   * invariant that a SUCCEEDED run's outcome is immutable. Scoring ever
   * uploads exactly one file — WHICH one depends on the run's own
   * `cvFoldsKey` (MODEL-FLOW-019-T20), so this now reads the row rather
   * than checking against one fixed literal.
   */
  async scoreUploadUrlsService(runId: string, filenames: string[]) {
    const run = await this.prisma.modelTrainingRun.findUnique({
      where: { id: runId },
      select: { cvFoldsKey: true },
    });
    if (!run) throw new NotFoundException();

    const allowedFilename = run.cvFoldsKey
      ? PREDICTIONS_FILENAME
      : HOLDOUT_PREDICTIONS_FILENAME;
    const disallowed = filenames.filter((f) => f !== allowedFilename);
    if (disallowed.length > 0) {
      throw new BadRequestException(
        `Scoring may only upload ${allowedFilename} — refused: ` +
          disallowed.join(', '),
      );
    }
    return this.runs.mintUploadUrls(runId, filenames);
  }

  /** CONTAINER-facing. Writes ONLY `predictionsKey`/`holdoutPredictionsKey`
   *  (whichever this run's kind uploaded — never both) + `holdoutMetrics`,
   *  and clears the in-flight marker — deliberately touches nothing else
   *  on the run row (no status, no finishedAt, no
   *  splitSpec/metrics/modelKey, no candidate-job nudge). The training
   *  run's own recorded outcome is immutable once SUCCEEDED. */
  async scoreCompleteService(runId: string, dto: ScoreCompleteDto) {
    const run = await this.prisma.modelTrainingRun.findUnique({
      where: { id: runId },
    });
    if (!run) throw new NotFoundException();

    const uploaded = new Set(dto.uploaded ?? []);
    const owner = resolveRunOwner(run);

    const updated = await this.prisma.modelTrainingRun.update({
      where: { id: runId },
      omit: { tokenHash: true },
      data: {
        predictionsKey: uploaded.has(PREDICTIONS_FILENAME)
          ? buildRunKey(owner, run.id, PREDICTIONS_FILENAME)
          : undefined,
        // MODEL-FLOW-019-T20. A non-CV run's score lands here, never in
        // predictionsKey — that column already holds this run's own test
        // split.
        holdoutPredictionsKey: uploaded.has(HOLDOUT_PREDICTIONS_FILENAME)
          ? buildRunKey(owner, run.id, HOLDOUT_PREDICTIONS_FILENAME)
          : undefined,
        holdoutMetrics: dto.holdoutMetrics ?? undefined,
        // Clears the poll target regardless of outcome — a FAILED score is
        // still a finished scoring phase, not a stuck one.
        scoringContainerId: null,
        // Close the scoring token with the phase — nothing legitimate
        // needs it after this point, same discipline complete() applies
        // to the training token.
        tokenExpiresAt: new Date(0),
      },
    });

    if (dto.status === 'FAILED') {
      await this.runs.appendLog(runId, {
        level: 'error',
        message: `Holdout scoring failed: ${dto.failureReason}`,
      });
    }

    return updated;
  }
}
