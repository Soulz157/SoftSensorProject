import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService, PrismaTypes, PrismaModels } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import { ModelCandidateJobAuthorizedService } from './model-candidate-job.authorized.service';
import type { TriggerRetrainDto } from './dto/model-retrain.authorized.dto';

/** The split a retrain reuses. `chronological` carries the ratio the
 *  incumbent was actually fitted on; `cv_expanding` is refused (see
 *  `resolveSplit`). Read off `ModelTrainingRun.splitSpec`, which is untyped
 *  Json on the row — the discriminant is `method`, the same field `claim()`
 *  and the run DTO's own union switch on. */
interface ChronologicalSplit {
  method: 'chronological';
  ratio: number;
}

/** Exported because it reaches the controller's inferred return type — a
 *  non-exported interface there fails the build's declaration emit
 *  (TS4053), not merely a lint rule. */
export interface MetricTriple {
  rmse: number | null;
  r2: number | null;
  mae: number | null;
}

function readMetric(metrics: unknown, key: string): number | null {
  if (!metrics || typeof metrics !== 'object') return null;
  const value = (metrics as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function metricTriple(metrics: unknown): MetricTriple {
  return {
    rmse: readMetric(metrics, 'rmse'),
    r2: readMetric(metrics, 'r2'),
    mae: readMetric(metrics, 'mae'),
  };
}

/**
 * MODEL-SERVE-004. POST /retrain — trigger only.
 *
 * A retrain is the SAME hyperparameter search MODEL-FLOW-005/013 already run
 * for the wizard (this ledger's decisions.retrain_is_blocked_on_the_same_
 * definition_as_fine_tuning, resolved: one algorithm, one artifact, one
 * split, N sets in sequence, best kept by RMSE), pointed at a saved Model
 * instead of a draft. It records intent and returns; the existing trainer
 * image does the work, spawned exactly the way MODEL-FLOW-003-T04 already
 * spawns it. Nothing here fits anything in-process (decisions.training_and_
 * serving_are_separate_planes), and nothing here promotes: a successful
 * retrain lands a STAGING ModelVersion and leaves the PRODUCTION pointer
 * untouched (T04, V01).
 *
 * A second service inside model-run/authorized rather than a new module,
 * because the shape follows the ENTITY, not the route: a retrain job IS a
 * ModelCandidateJob and its candidates ARE ModelTrainingRuns, both owned by
 * this module. Only the HTTP prefix is shared with model-version and
 * prediction-job (`authorized/model/:modelId`).
 */
@Injectable()
export class ModelRetrainAuthorizedService {
  private readonly log = new Logger(ModelRetrainAuthorizedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly candidateJobs: ModelCandidateJobAuthorizedService,
  ) {}

  // ── access ───────────────────────────────────────────────────────────────

  /** Editor-level, the same rule every other mutating Model route applies —
   *  triggering N container fits against a production model is not a read.
   *  The fourth identical copy of this check (model-version, model-run-launch
   *  and prediction-job hold the others); `prediction-job.authorized.service.
   *  ts`'s own note records why a shared helper was not extracted for three
   *  call sites, and that reasoning is unchanged at four — extracting it
   *  touches four modules and is not part of this feature. */
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
   * Copied from `prediction-job.authorized.service.ts` (MODEL-SERVE-003-V02),
   * NOT from `model-version.authorized.service.ts` — that copy checks
   * `err.meta.target`, which this Prisma version's driver-adapter P2002 does
   * not carry at all, so it never matches and its intended graceful path is
   * a raw 500 under real concurrency. The constraint name lives at
   * `meta.driverAdapterError.cause.originalMessage`; both shapes are checked
   * so a future Prisma upgrade that restores `target` keeps working.
   */
  private isUniqueViolation(err: unknown, constraint: string): boolean {
    if (
      !(err instanceof PrismaTypes.PrismaClientKnownRequestError) ||
      err.code !== 'P2002'
    ) {
      return false;
    }
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

  // ── trigger ──────────────────────────────────────────────────────────────

  /**
   * MODEL-SERVE-004-T02/T03/T04. Records the intent to retrain and returns.
   *
   * The incumbent is the PRODUCTION version and nothing else: with no
   * promoted version there is no "what is live" to improve on and no
   * comparison basis to publish, so this refuses rather than quietly
   * retraining whatever was saved last (the same precondition
   * `submitPredictionJobService` enforces one entity over).
   *
   * Concurrency is a DATABASE fact, not a read-then-write check: the row is
   * created FIRST, and only the request that owns it reaches the spawn. Two
   * losers of a three-way race are refused by
   * `ModelCandidateJob_one_live_per_model` before any container exists —
   * which is what makes V02 ("count containers, not jobs") pass.
   */
  async triggerRetrainService(
    modelId: string,
    dto: TriggerRetrainDto,
    user: Auth.UserPayload,
  ) {
    await this.assertModelAccess(modelId, user);

    const incumbent = await this.prisma.modelVersion.findFirst({
      where: { modelId, stage: 'PRODUCTION' },
    });
    if (!incumbent) {
      throw new AppException({
        statusCode: 404,
        message:
          `Model ${modelId} has no PRODUCTION version. Promote a version ` +
          'before retraining — a retrain improves on what is live.',
        type: 'ERROR',
      });
    }

    // The incumbent's OWN run row, one hop off `sourceRunId`. `targetY` lives
    // only here (ModelVersion snapshots the artifact and the algorithm, not
    // the target), and so does the split that was actually fitted.
    const sourceRun = await this.prisma.modelTrainingRun.findUnique({
      where: { id: incumbent.sourceRunId },
    });
    if (!sourceRun) {
      throw new AppException({
        statusCode: 422,
        message:
          `Version ${incumbent.version}'s source run no longer exists; ` +
          'there is nothing to reproduce its training basis from.',
        type: 'ERROR',
      });
    }

    const split = this.resolveSplit(sourceRun.splitSpec, incumbent.version);

    // Candidates: the operator's own list, or the incumbent's configuration
    // expanded through the SAME curated grid the wizard's search uses. Either
    // way every candidate shares the incumbent's artifact, target and split —
    // that shared basis is what makes T05's comparison a real comparison.
    const requested =
      dto.candidates ??
      this.candidateJobs.expandSearchCandidates({
        algorithm: incumbent.algorithm,
        hyperparameters: (incumbent.hyperparameters ?? {}) as Record<
          string,
          unknown
        >,
      });
    const candidates = requested.map((candidate) => ({
      ...candidate,
      phase: 1,
    }));

    // Own declaration, never an inline cast in the `data` literal — an inline
    // `as unknown as X` on one field collapses Prisma's generic return-type
    // inference for the whole call to `any` (see createJob's own note).
    const candidatesJson = candidates as unknown as PrismaTypes.InputJsonValue;

    let job: PrismaModels.ModelCandidateJobModel;
    try {
      job = await this.prisma.modelCandidateJob.create({
        data: {
          modelId,
          sourceVersionId: incumbent.id,
          idempotencyKey: dto.idempotencyKey ?? null,
          targetY: sourceRun.targetY,
          goldArtifactId: incumbent.goldArtifactId,
          trainTestSplit: split.ratio,
          kind: 'HYPERPARAMETER_SEARCH',
          candidates: candidatesJson,
          totalRuns: candidates.length,
          createdById: user.id,
          status: 'QUEUED',
        },
      });
    } catch (err) {
      if (
        dto.idempotencyKey &&
        this.isUniqueViolation(err, 'ModelCandidateJob_idempotency_key')
      ) {
        const existing = await this.prisma.modelCandidateJob.findFirst({
          where: { modelId, idempotencyKey: dto.idempotencyKey },
        });
        if (existing) {
          return {
            statusCode: 200,
            message: 'A retrain already exists for this idempotency key',
            type: 'SUCCESS' as const,
            data: this.triggerView(existing),
          };
        }
      }
      if (this.isUniqueViolation(err, 'ModelCandidateJob_one_live_per_model')) {
        const live = await this.prisma.modelCandidateJob.findFirst({
          where: { modelId, status: { in: ['QUEUED', 'RUNNING'] } },
          select: { id: true },
        });
        throw new AppException({
          statusCode: 409,
          message:
            `Model ${modelId} already has a retrain in progress` +
            `${live ? ` (job ${live.id})` : ''}. Wait for it to finish.`,
          type: 'ERROR',
        });
      }
      throw err;
    }

    try {
      const firstRun = await this.candidateJobs.launchForJob(
        job,
        candidates[0],
      );
      const updated = await this.prisma.modelCandidateJob.update({
        where: { id: job.id },
        data: {
          status: 'RUNNING',
          currentRunId: firstRun.id,
          startedAt: new Date(),
        },
      });
      return {
        statusCode: 201,
        message: 'Retrain started',
        type: 'SUCCESS' as const,
        data: this.triggerView(updated),
      };
    } catch (err) {
      // Mirrors createJob's own recovery: the row would otherwise be stranded
      // QUEUED with no run and no way to advance, AND it would hold the
      // per-model live lock indefinitely — marking it FAILED frees the index
      // immediately, so a bad first candidate does not block the next
      // trigger.
      this.log.error(
        `retrain job ${job.id}: could not launch the first candidate`,
        err,
      );
      await this.prisma.modelCandidateJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          failureReason: `Could not launch the first candidate: ${(err as Error).message}`,
          finishedAt: new Date(),
        },
      });
      throw err;
    }
  }

  /**
   * MODEL-SERVE-004-T03's narrowing, stated rather than discovered later: a
   * retrain reuses the incumbent's split verbatim, and a job row carries one
   * `trainTestSplit` ratio. An incumbent fitted with expanding-window CV has
   * no single ratio to reuse — reconstructing one would silently retrain on a
   * DIFFERENT basis than the version it claims to improve on, which is the
   * exact thing T05 exists to prevent. Refused with the reason named.
   */
  private resolveSplit(
    splitSpec: PrismaTypes.JsonValue,
    version: number,
  ): ChronologicalSplit {
    const spec = splitSpec as { method?: string; ratio?: unknown } | null;
    if (spec?.method === 'cv_expanding') {
      throw new AppException({
        statusCode: 422,
        message:
          `Version ${version} was fitted with expanding-window cross-` +
          "validation. Retrain reuses the incumbent's own split, and a CV " +
          'retrain is not implemented — retrain from a chronologically ' +
          'split version, or train a new model in the wizard.',
        type: 'ERROR',
      });
    }
    // Every chronological run records a ratio (buildRunData writes it at
    // creation, defaulting to 0.8) — read defensively anyway: a legacy row
    // with no readable ratio must not silently fall through to the run DTO's
    // own default, which would be a DIFFERENT split presented as the
    // incumbent's.
    const ratio = typeof spec?.ratio === 'number' ? spec.ratio : null;
    if (ratio === null || !(ratio > 0 && ratio < 1)) {
      throw new AppException({
        statusCode: 422,
        message:
          `Version ${version}'s source run records no usable train/test ` +
          'ratio, so a retrain cannot reproduce its evaluation basis.',
        type: 'ERROR',
      });
    }
    return { method: 'chronological', ratio };
  }

  /** The trigger response: ids and state only. Deliberately not the whole
   *  row — a caller polls `GET .../retrain/:jobId` for progress. */
  private triggerView(job: PrismaModels.ModelCandidateJobModel) {
    return {
      jobId: job.id,
      status: job.status,
      sourceVersionId: job.sourceVersionId,
      totalRuns: job.totalRuns,
      completedRuns: job.completedRuns,
    };
  }

  // ── read ─────────────────────────────────────────────────────────────────

  /**
   * MODEL-SERVE-004-T05. The job's live state (reconciled on read through the
   * SAME method the wizard's own job GET uses) plus the candidate-versus-
   * incumbent comparison.
   */
  async getRetrainJobService(
    modelId: string,
    jobId: string,
    user: Auth.UserPayload,
  ) {
    await this.assertModelAccess(modelId, user);
    const found = await this.prisma.modelCandidateJob.findFirst({
      where: { id: jobId, modelId },
    });
    if (!found) throw new NotFoundException('Retrain job not found');

    const { job, candidates } =
      await this.candidateJobs.reconcileAndShape(found);
    const comparison = await this.buildComparison(job);

    return {
      statusCode: 200,
      message: 'Retrain job fetched',
      type: 'SUCCESS' as const,
      data: { ...job, candidates, comparison },
    };
  }

  /**
   * MODEL-SERVE-004-T05, narrowed against T01 rather than implemented as
   * written. T05 was drafted while "retrain" might still have meant a refit
   * on a widened window, and it worried that a raw delta across two different
   * test splits reads like a like-for-like number and is not. T01's
   * resolution removed that case: a retrain reuses the incumbent's artifact,
   * target and split, so the delta IS like-for-like. What T05 actually asks
   * for survives as a CHECK rather than a caveat — the basis is compared
   * field by field, and `rmseDelta` is emitted only when it holds. When it
   * does not (an incumbent whose run row points elsewhere, a legacy row, a
   * candidate that has not finished), both raw numbers are still published
   * with `comparable: false` and a reason, and the delta is null.
   *
   * RMSE leads, not R²: an observed real run in this system scored
   * r2 = -1,110,858 while RMSE stayed a sane comparable number
   * (MODEL-FLOW-004's finding, and why the search selects on RMSE at all).
   * R² is reported beside it, never used to rank.
   */
  private async buildComparison(job: PrismaModels.ModelCandidateJobModel) {
    if (!job.sourceVersionId) return null;

    const incumbent = await this.prisma.modelVersion.findUnique({
      where: { id: job.sourceVersionId },
    });
    if (!incumbent) return null;

    const candidateRunId = job.selectedRunId ?? job.bestRunId;
    const [incumbentRun, candidateRun] = await Promise.all([
      this.prisma.modelTrainingRun.findUnique({
        where: { id: incumbent.sourceRunId },
      }),
      // `selectedRunId ?? bestRunId` — the resolution convention every other
      // reader of a candidate job uses, so an operator override is honoured
      // here too without this method learning a second rule.
      candidateRunId
        ? this.prisma.modelTrainingRun.findUnique({
            where: { id: candidateRunId },
          })
        : Promise.resolve(null),
    ]);

    const incumbentSplit =
      (incumbentRun?.splitSpec as {
        method?: string;
        ratio?: number;
      } | null) ?? null;
    const candidateSplit =
      (candidateRun?.splitSpec as {
        method?: string;
        ratio?: number;
      } | null) ?? null;

    const mismatches: string[] = [];
    if (!candidateRun) {
      mismatches.push('no candidate has produced a result yet');
    } else if (!incumbentRun) {
      mismatches.push("the incumbent's source run no longer exists");
    } else {
      if (candidateRun.goldArtifactId !== incumbentRun.goldArtifactId) {
        mismatches.push('different training artifact');
      }
      if (candidateRun.artifactChecksum !== incumbentRun.artifactChecksum) {
        mismatches.push('different artifact checksum');
      }
      if (candidateRun.targetY !== incumbentRun.targetY) {
        mismatches.push('different target');
      }
      if (
        candidateSplit?.method !== incumbentSplit?.method ||
        candidateSplit?.ratio !== incumbentSplit?.ratio
      ) {
        mismatches.push('different train/test split');
      }
    }

    const comparable = mismatches.length === 0;
    // The incumbent's numbers come from the VERSION row, not from its run:
    // that snapshot is what promote's r2 floor checks and what serving
    // reports, and it must not drift under a run row nothing else is touching
    // (ModelVersion.metrics' own schema comment).
    const incumbentMetrics = metricTriple(incumbent.metrics);
    const candidateMetrics = metricTriple(candidateRun?.metrics ?? null);
    const rmseDelta =
      comparable &&
      candidateMetrics.rmse !== null &&
      incumbentMetrics.rmse !== null
        ? candidateMetrics.rmse - incumbentMetrics.rmse
        : null;

    return {
      // The BASIS both sides were scored on, published beside the numbers —
      // never a delta presented alone.
      basis: {
        goldArtifactId: incumbentRun?.goldArtifactId ?? null,
        artifactChecksum: incumbentRun?.artifactChecksum ?? null,
        targetY: incumbentRun?.targetY ?? null,
        split: incumbentSplit,
        comparable,
        reason: comparable ? null : mismatches.join('; '),
      },
      incumbent: {
        versionId: incumbent.id,
        version: incumbent.version,
        stage: incumbent.stage,
        algorithm: incumbent.algorithm,
        metrics: incumbentMetrics,
      },
      candidate: {
        runId: candidateRun?.id ?? null,
        // Set once the job has completed and minted its STAGING version.
        versionId: job.resultVersionId,
        algorithm: candidateRun?.algorithm ?? null,
        metrics: candidateMetrics,
      },
      // Negative = the candidate is better (lower RMSE). Null whenever the
      // bases differ — both raw numbers above are still present.
      rmseDelta,
      selectionMetric: 'rmse' as const,
    };
  }
}
