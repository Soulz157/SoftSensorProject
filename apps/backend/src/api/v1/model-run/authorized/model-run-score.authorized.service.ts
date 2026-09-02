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

/** predictions.parquet — the one filename scoring ever uploads. Matches
 *  `complete()`'s own literal (RUN_UPLOAD_FILENAMES has no dedicated
 *  constant for this filename either). */
const PREDICTIONS_FILENAME = 'predictions.parquet';

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
    // splitSpec is untyped Json on the row — cvFoldsKey is the durable,
    // typed signal (set only by complete() for a CV run) and is what
    // `claim()`'s own isCvRun gate exists to make possible in the first
    // place: a non-CV run already has its holdout scored inline.
    if (!run.cvFoldsKey) {
      throw new BadRequestException(
        `Run ${runId} is not a Cross-Validation run — its holdout score ` +
          'is already computed during training.',
      );
    }
    if (run.scoringContainerId) {
      throw new BadRequestException(`Run ${runId} is already being scored.`);
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
   * uploads exactly one file.
   */
  scoreUploadUrlsService(runId: string, filenames: string[]) {
    const disallowed = filenames.filter((f) => f !== PREDICTIONS_FILENAME);
    if (disallowed.length > 0) {
      throw new BadRequestException(
        `Scoring may only upload ${PREDICTIONS_FILENAME} — refused: ` +
          disallowed.join(', '),
      );
    }
    return this.runs.mintUploadUrls(runId, filenames);
  }

  /** CONTAINER-facing. Writes ONLY `predictionsKey` + `holdoutMetrics` and
   *  clears the in-flight marker — deliberately touches nothing else on
   *  the run row (no status, no finishedAt, no splitSpec/metrics/modelKey,
   *  no candidate-job nudge). The training run's own recorded outcome is
   *  immutable once SUCCEEDED. */
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
