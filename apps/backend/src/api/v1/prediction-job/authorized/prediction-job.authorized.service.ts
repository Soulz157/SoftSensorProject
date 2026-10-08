import { Injectable, Logger } from '@nestjs/common';
import { PrismaService, PrismaTypes } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import { mintRunToken } from '@/lib/mint-run-token';
import {
  presignArtifact,
  presignPredictionJobObject,
  presignPredictionJobUpload,
} from '@/lib/python-preprocess-client';
import { predictionJobKey, OUTPUT_FILENAME } from '@/lib/artifact-keys';
import { TrainningContainerAuthorizedService } from '../../trainning-container/authorized/trainning-container.authorized.service';
import { ModelServingAuthorizedService } from '../../model-serving/authorized/model-serving.authorized.service';
import type {
  PredictionJobCompleteDto,
  PredictionJobLogDto,
  PredictionJobUploadUrlsDto,
  SubmitPredictionJobDto,
} from './dto/prediction-job.authorized.dto';

/** Same TTL shape as MODEL-FLOW-016-T07's SCORE_TOKEN_TTL_MS (2h, shorter
 *  than training's 12h) — a batch score is bounded work, not an open-ended
 *  fit; a hung container should not hold a live credential indefinitely. */
const PREDICTION_JOB_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * MODEL-SERVE-003. Batch prediction: submit a parquet already in object
 * storage, get a job id back immediately, poll it, collect the output by
 * presigned reference. Its own module, matching model-run/model-version's
 * one-feature-per-module convention — a different caller for the container
 * routes (PredictionJobTokenGuard) than the submit/status routes (JWT), the
 * same split model-run keeps between ModelRunAuthorizedController and
 * ModelRunLaunchAuthorizedController.
 */
@Injectable()
export class PredictionJobAuthorizedService {
  private readonly log = new Logger(PredictionJobAuthorizedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: TrainningContainerAuthorizedService,
    private readonly descriptor: ModelServingAuthorizedService,
  ) {}

  // ── access ───────────────────────────────────────────────────────────────

  /** Editor-level, same rule every other mutating Model route applies —
   *  submitting compute against a production model is not a read. Mirrors
   *  `ModelVersionAuthorizedService.assertModelAccess` — no shared helper
   *  exists for this in the codebase (it is already duplicated identically
   *  in model-version and model-run-launch), so a third copy here follows
   *  the established convention rather than introducing a new abstraction
   *  for three call sites. */
  private async assertModelAccess(modelId: string, user: Auth.UserPayload) {
    const model = await this.prisma.model.findUnique({
      where: { id: modelId },
      select: { id: true, workspaceId: true },
    });
    if (!model) {
      throw new AppException({
        statusCode: 404,
        message: 'Model not found',
        type: 'ERROR',
      });
    }
    if (user.role === 'ADMIN') return model;

    const workspace = await this.prisma.workspace.findFirst({
      where: { id: model.workspaceId, ownerId: user.id },
      select: { id: true },
    });
    if (workspace) return model;
    const member = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId: model.workspaceId, userId: user.id },
    });
    if (!member || member.role === 'VIEWER') {
      throw new AppException({
        statusCode: 403,
        message: 'Forbidden: editor access required',
        type: 'ERROR',
      });
    }
    return model;
  }

  /**
   * MODEL-SERVE-003-V02. LIVE-VERIFIED against a real concurrent race that
   * this codebase's other two copies of this exact check (model-version.
   * authorized.service.ts, dataset-draft.authorized.service.ts) test the
   * WRONG shape: `err.meta.target` does not exist at all on this Prisma
   * version's driver-adapter P2002 — reproduced live, `err.meta` was
   * `{modelName, driverAdapterError: {cause: {originalCode: "23505",
   * originalMessage: 'duplicate key value violates unique constraint
   * "PredictionJob_idempotency_key"', constraint: {fields: [...]}}}}`, no
   * `target` anywhere. A `target`-only check therefore NEVER matches a
   * genuine collision on any of the three call sites, and each one falls
   * through to `throw err` (a raw 500) instead of its intended fallback —
   * confirmed live here (500, not the graceful "job already exists"
   * response) before this fix. Checks both shapes so a future Prisma
   * upgrade that reverts to `target` keeps working too.
   */
  private isUniqueViolation(err: unknown, constraint?: string): boolean {
    if (
      !(err instanceof PrismaTypes.PrismaClientKnownRequestError) ||
      err.code !== 'P2002'
    ) {
      return false;
    }
    if (!constraint) return true;
    const meta = err.meta;
    const target = meta?.target;
    const targetStr = Array.isArray(target)
      ? target.join(',')
      : typeof target === 'string'
        ? target
        : '';
    const driverErr = meta?.driverAdapterError as
      | { cause?: { originalMessage?: unknown } }
      | undefined;
    const originalMessage =
      typeof driverErr?.cause?.originalMessage === 'string'
        ? driverErr.cause.originalMessage
        : '';
    return `${targetStr} ${originalMessage}`.includes(constraint);
  }

  private mintToken(): { token: string; tokenHash: string } {
    return mintRunToken();
  }

  /**
   * Spawn out of band — mirrors `ModelRunLaunchAuthorizedService.
   * trackSpawn`'s exact shape. A submit request must not block for the
   * length of an image pull, and the job row is already durable; a spawn
   * failure marks it FAILED rather than losing it.
   */
  private trackSpawn(jobId: string, token: string): void {
    void this.runner.spawn(jobId, token, 'batch').catch(async (err) => {
      const reason = err instanceof Error ? err.message : String(err);
      this.log.error(`spawn failed for prediction job ${jobId}`, err);
      await this.prisma.predictionJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          failureReason: `Could not start container: ${reason}`.slice(0, 2000),
          finishedAt: new Date(),
          tokenExpiresAt: new Date(0),
        },
      });
    });
  }

  // ── user-facing ──────────────────────────────────────────────────────────

  /**
   * MODEL-SERVE-003-T02/T05. Idempotency: partial unique index
   * (modelId, idempotencyKey) → catch P2002 BY CONSTRAINT NAME → fall back
   * to reading the winner's row — the exact shape
   * `dataset-draft.authorized.service.ts`'s `resolveOrCreateEditDraftService`
   * already proves safe under genuine concurrency (V02), not merely a
   * documented intention.
   *
   * T05: `modelVersionId` is pinned HERE, at submit, to whatever is
   * currently PRODUCTION — never re-resolved later. A promote landing
   * mid-batch (V03) must not silently retarget an already-submitted job.
   */
  async submitPredictionJobService(
    modelId: string,
    dto: SubmitPredictionJobDto,
    user: Auth.UserPayload,
  ) {
    await this.assertModelAccess(modelId, user);

    const version = await this.prisma.modelVersion.findFirst({
      where: { modelId, stage: 'PRODUCTION' },
      select: { id: true },
    });
    if (!version) {
      throw new AppException({
        statusCode: 404,
        message: `Model ${modelId} has no PRODUCTION version. Cannot submit a batch prediction job.`,
        type: 'ERROR',
      });
    }

    const { token, tokenHash } = this.mintToken();

    try {
      const job = await this.prisma.predictionJob.create({
        data: {
          modelId,
          modelVersionId: version.id,
          inputKey: dto.inputKey,
          idempotencyKey: dto.idempotencyKey ?? null,
          status: 'QUEUED',
          imageDigest: this.runner.imageDigest,
          tokenHash,
          tokenExpiresAt: new Date(Date.now() + PREDICTION_JOB_TOKEN_TTL_MS),
          createdById: user.id,
        },
      });
      this.trackSpawn(job.id, token);
      return {
        statusCode: 201,
        message: 'Batch prediction job submitted',
        type: 'SUCCESS' as const,
        data: {
          jobId: job.id,
          status: job.status,
          modelVersionId: job.modelVersionId,
        },
      };
    } catch (err) {
      // Same P2002-by-constraint-name → fall back to the winner's row shape
      // model-version.authorized.service.ts uses for
      // ModelVersion_one_production_per_model — but see this file's own
      // `isUniqueViolation` doc comment for why its shape check differs.
      if (
        dto.idempotencyKey &&
        this.isUniqueViolation(err, 'PredictionJob_idempotency_key')
      ) {
        const existing = await this.prisma.predictionJob.findFirst({
          where: { modelId, idempotencyKey: dto.idempotencyKey },
        });
        if (existing) {
          return {
            statusCode: 200,
            message: 'A job already exists for this idempotency key',
            type: 'SUCCESS' as const,
            data: {
              jobId: existing.id,
              status: existing.status,
              modelVersionId: existing.modelVersionId,
            },
          };
        }
      }
      throw err;
    }
  }

  /**
   * MODEL-SERVE-003-T04. The output URL is minted ON READ, so it is always
   * fresh and short-lived rather than stored — same discipline
   * `presignRunObject`'s whole family already follows. Never log this
   * request or its result (MODEL-FLOW-000-T06): the URL IS the capability.
   */
  async getJobStatusService(
    modelId: string,
    jobId: string,
    user: Auth.UserPayload,
  ) {
    await this.assertModelAccess(modelId, user);

    const job = await this.prisma.predictionJob.findFirst({
      where: { id: jobId, modelId },
    });
    if (!job) {
      throw new AppException({
        statusCode: 404,
        message: 'Prediction job not found',
        type: 'ERROR',
      });
    }

    let outputUrl: string | null = null;
    if (job.status === 'SUCCEEDED' && job.outputKey) {
      const presigned = await presignPredictionJobObject({
        source_key: job.outputKey,
      });
      outputUrl = presigned.data_url;
    }

    return {
      statusCode: 200,
      message: 'Prediction job status',
      type: 'SUCCESS' as const,
      data: {
        jobId: job.id,
        modelId: job.modelId,
        modelVersionId: job.modelVersionId,
        status: job.status,
        inputKey: job.inputKey,
        rowCount: job.rowCount,
        failureReason: job.failureReason,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        outputUrl,
      },
    };
  }

  // ── container-facing (PredictionJobTokenGuard) ─────────────────────────

  /**
   * MODEL-SERVE-003. Mirrors `scoreClaimService`'s shape one entity over:
   * everything the batch container needs to load its PINNED model version
   * and score its input, in one round trip.
   *
   * `presignArtifact` reuses the INPUT presign path unchanged (T04, honoured
   * literally) — the input is an existing committed dataset artifact and
   * passes `is_committed_artifact_key` as-is. The OUTPUT path is a sibling
   * function (`presignPredictionJobUpload`, called from `uploadUrlsService`
   * below), not this one — see the delta-re-audit finding on why widening
   * the committed-artifact guard was the wrong fix.
   *
   * Resolved by `modelVersionId`, deliberately NOT by re-querying "current
   * PRODUCTION for this model" — the whole point of pinning at submit is
   * that a promote landing between submit and claim must not retarget an
   * already-queued job (T05, V03).
   */
  async claimJobService(jobId: string) {
    const job = await this.prisma.predictionJob.findUniqueOrThrow({
      where: { id: jobId },
    });

    const descriptorResult =
      await this.descriptor.getDescriptorByVersionIdService(job.modelVersionId);
    const d = descriptorResult.data;

    const inputPresigned = await presignArtifact({
      source_key: job.inputKey,
    });

    return {
      modelId: d.modelId,
      modelVersionId: d.versionId,
      modelUrl: d.modelUrl,
      modelChecksum: d.modelChecksum,
      inputUrl: inputPresigned.data_url,
      inputChecksum: inputPresigned.checksum,
      featureColumns: d.featureColumns,
      scalers: d.scalers,
      scalingParams: d.scalingParams,
    };
  }

  /**
   * Best-effort, never persisted — `PredictionJob` carries no `logs`
   * relation (unlike `ModelTrainingRun`/`ModelTrainingRunLog`), and nothing
   * in this feature's acceptance criteria asks for queryable batch-job
   * logs. The container's own `RunApi.log` already mirrors every line to
   * stderr regardless (`images/trainer/app/api.py`), so this is purely a
   * server-side echo for whoever is tailing backend logs live.
   */
  logService(jobId: string, dto: PredictionJobLogDto): void {
    const method =
      dto.level === 'error' ? 'error' : dto.level === 'warn' ? 'warn' : 'log';
    this.log[method](`[prediction job ${jobId}] ${dto.message}`);
  }

  async uploadUrlsService(jobId: string, dto: PredictionJobUploadUrlsDto) {
    const job = await this.prisma.predictionJob.findUniqueOrThrow({
      where: { id: jobId },
    });
    return presignPredictionJobUpload({
      model_id: job.modelId,
      job_id: job.id,
      filenames: dto.filenames,
    });
  }

  /**
   * MODEL-SERVE-003. The container's own terminal report. `outputKey` is
   * built HERE, server-side, from the job's own ids — never trusted from
   * the request body, matching `scoreCompleteService`'s
   * `buildRunKey(owner, run.id, 'predictions.parquet')` discipline one
   * entity over.
   */
  async completeJobService(jobId: string, dto: PredictionJobCompleteDto) {
    const job = await this.prisma.predictionJob.findUniqueOrThrow({
      where: { id: jobId },
    });

    if (dto.status === 'FAILED') {
      await this.prisma.predictionJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          failureReason: dto.failureReason,
          finishedAt: new Date(),
          tokenExpiresAt: new Date(0),
        },
      });
      return {
        statusCode: 200,
        message: 'Recorded',
        type: 'SUCCESS' as const,
      };
    }

    const outputKey = predictionJobKey(job.modelId, job.id, OUTPUT_FILENAME);

    await this.prisma.predictionJob.update({
      where: { id: jobId },
      data: {
        status: 'SUCCEEDED',
        outputKey,
        outputChecksum: dto.outputChecksum,
        rowCount: dto.rowCount,
        finishedAt: new Date(),
        tokenExpiresAt: new Date(0),
      },
    });
    return { statusCode: 200, message: 'Recorded', type: 'SUCCESS' as const };
  }
}
