import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService, PrismaTypes, PrismaModels } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import {
  CreateCandidateJobDto,
  SelectCandidateDto,
} from './dto/model-candidate-job.authorized.dto';
import { CreateTrainingRunDto } from './dto/model-run.authorized.dto';
import { ModelRunLaunchAuthorizedService } from './model-run-launch.authorized.service';
import {
  getRunLossHistory,
  getRunManifest,
} from '@/lib/python-preprocess-client';
import { tuningCandidatesFor } from '@/lib/tuning-grid';
import {
  buildModelVersionData,
  nextModelVersionNumber,
} from '@/lib/model-version-from-run';

interface Candidate {
  algorithm: string;
  hyperparameters: Record<string, unknown>;
  /**
   * MODEL-FLOW-013-T11. 1 (the sweep) or 2 (the tune-the-winner phase,
   * SWEEP_THEN_TUNE only). Stamped server-side ONLY — `CandidateSchema` has
   * no `phase` field, so a client can never author this. Absent on a row
   * written before this field existed; every reader treats that as phase 1
   * (`candidate.phase ?? 1`).
   */
  phase?: number;
}

/**
 * `ModelRunLaunchAuthorizedService.launchDraftRun`'s actual return shape
 * (it `omit`s `tokenHash`). Every `let X;` below that this type annotates
 * is assigned exactly once, inside a `try { X = await ... } catch { return;
 * }` — `@typescript-eslint`'s type-aware checker does not narrow an
 * unannotated `let` through that shape, so a bare `let job;`/`let nextRun;`
 * resolves as `any` at every later use (`job.id`, `nextRun.id`, …), even
 * though `tsc` itself infers the real type fine. An explicit annotation
 * here is what makes the difference, not a behavior change.
 */
type LaunchedRun = Omit<PrismaModels.ModelTrainingRunModel, 'tokenHash'>;

/**
 * MODEL-FLOW-005, generalized by MODEL-FLOW-013-T03. Originally "fine-tuning"
 * = a hyperparameter search: one algorithm, one artifact, one split, N
 * hyperparameter sets tried in sequence, best kept
 * (decisions.fine_tuning_undefined, 2026-08-25). Now a CANDIDATE job: N
 * candidates, each `{algorithm, hyperparameters}` — a hyperparameter search
 * repeats the same algorithm on every candidate, an algorithm sweep varies
 * it ("Find Best Model"). No new spawn/claim/complete path exists — every
 * candidate is an ordinary `ModelTrainingRun`, tagged with `candidateJobId`,
 * launched through the exact machinery MODEL-FLOW-003 already built and
 * live-verified (`ModelRunLaunchAuthorizedService.launchDraftRun`). This
 * service only decides WHEN to launch the next one and WHICH run wins.
 *
 * Advancing a job is IDEMPOTENT and callable from two places, both handled
 * identically by `advanceJobForRun`: `ModelRunAuthorizedService.complete()`
 * calls it as a best-effort nudge the instant a candidate run's webhook
 * lands (the fast path), and `getJobService` calls it opportunistically on
 * every read (the reconciling path) — so a job whose nudge was lost (a crash
 * between the run's DB write and the nudge, the same class of gap
 * MODEL-FLOW-011-T04 already tracks for a single run) still advances the
 * next time anyone looks at it. Both paths funnel through one
 * compare-and-swap `updateMany` keyed on `(id, currentRunId, status)`, so
 * calling it twice for the same terminated run is a no-op the second time —
 * no separate locking, no queue.
 */
@Injectable()
export class ModelCandidateJobAuthorizedService {
  private readonly log = new Logger(ModelCandidateJobAuthorizedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly runLaunch: ModelRunLaunchAuthorizedService,
  ) {}

  private isUniqueViolation(err: unknown): boolean {
    return (
      err instanceof PrismaTypes.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    );
  }

  private extractRmse(metrics: unknown): number | null {
    if (!metrics || typeof metrics !== 'object') return null;
    const rmse = (metrics as Record<string, unknown>).rmse;
    return typeof rmse === 'number' && Number.isFinite(rmse) ? rmse : null;
  }

  /**
   * MODEL-SERVE-004. A candidate job is owned by a ModelDraft (the wizard's
   * search/sweep) or by a Model (a retrain) — never both, never neither, by
   * the `ModelCandidateJob_owner_exactly_one` CHECK. Both owners launch the
   * SAME `ModelTrainingRun` through the SAME `buildRunData` validation; only
   * the row's owner column and the object-key root differ (`models/…` vs
   * `drafts/…`, resolved downstream by `resolveRunOwner`). Every caller in
   * this file goes through here rather than naming a launcher directly, so
   * the two owners cannot drift.
   */
  launchForJob(
    job: {
      id: string;
      modelDraftId: string | null;
      modelId: string | null;
      goldArtifactId: string;
      targetY: string;
      trainTestSplit: number | null;
    },
    candidate: Candidate,
  ): Promise<LaunchedRun> {
    const dto = this.runDtoFor(job, candidate);
    if (job.modelId) {
      return this.runLaunch.launchModelRun(job.modelId, dto, job.id);
    }
    if (job.modelDraftId) {
      return this.runLaunch.launchDraftRun(job.modelDraftId, dto, job.id);
    }
    // Unreachable while the CHECK constraint holds — kept so a row that
    // somehow has neither owner fails loudly here instead of launching
    // nothing and leaving the job stranded RUNNING.
    throw new AppException({
      statusCode: 500,
      message: `Candidate job ${job.id} has neither a draft nor a model owner.`,
      type: 'ERROR',
    });
  }

  /**
   * MODEL-FLOW-013 / MODEL-SERVE-004. A HYPERPARAMETER_SEARCH names ONE
   * starting candidate and relies on the curated `TUNING_GRID` shortlist for
   * the rest. Extracted from `createJob` so the retrain path
   * (`ModelRetrainAuthorizedService`) expands the incumbent's own
   * hyperparameters through the IDENTICAL grid rather than a second copy of
   * it — the grid stays declared in exactly one place, and so does the
   * refusal when an algorithm has no variants to try.
   */
  expandSearchCandidates(base: {
    algorithm: string;
    hyperparameters: Record<string, unknown>;
  }): Array<{ algorithm: string; hyperparameters: Record<string, unknown> }> {
    const variants = tuningCandidatesFor(
      base.algorithm,
      base.hyperparameters as Record<string, string | number | boolean | null>,
    );
    if (variants.length === 0) {
      throw new AppException({
        statusCode: 400,
        message: `No distinct hyperparameter variants to try for ${base.algorithm} — nothing to search.`,
        type: 'ERROR',
      });
    }
    return [
      base,
      ...variants.map((hyperparameters) => ({
        algorithm: base.algorithm,
        hyperparameters,
      })),
    ];
  }

  private runDtoFor(
    job: {
      goldArtifactId: string;
      targetY: string;
      trainTestSplit: number | null;
    },
    candidate: Candidate,
  ): CreateTrainingRunDto {
    return {
      goldArtifactId: job.goldArtifactId,
      targetY: job.targetY,
      algorithm: candidate.algorithm as CreateTrainingRunDto['algorithm'],
      hyperparameters: candidate.hyperparameters,
      trainTestSplit: job.trainTestSplit ?? undefined,
    } as CreateTrainingRunDto;
  }

  /**
   * MODEL-FLOW-005-T01/T02/T03/T04. Creates the job row and launches its
   * FIRST candidate in the same request — mirrors `createDraftRunService`'s
   * own synchronous validate-then-spawn shape, so a job that comes back 201
   * really has started, the same guarantee a single run already gives.
   */
  async createJob(
    draftId: string,
    dto: CreateCandidateJobDto,
    userId: string,
    role: string,
  ) {
    await this.runLaunch.assertDraftWritable(draftId, userId, role);

    // A direct HYPERPARAMETER_SEARCH request (exactly 1 algorithm selected,
    // no sweep) names ONE candidate — its current hyperparameters — and
    // relies on THIS expansion into the curated TUNING_GRID shortlist,
    // reusing the exact same `tuningCandidatesFor` SWEEP_THEN_TUNE's phase 2
    // already calls (see `advanceJobForRun` below), so the grid stays
    // declared in exactly one place. `alreadyTried` is the base candidate's
    // own hyperparameters — the same "don't repeat what's already covered"
    // exclusion phase 2 relies on, applied here to the search's own starting
    // point instead of a sweep's winner.
    const requestedCandidates =
      dto.kind === 'HYPERPARAMETER_SEARCH' && dto.candidates.length === 1
        ? this.expandSearchCandidates(dto.candidates[0])
        : dto.candidates;

    // Every candidate a client sends is phase 1 — `CandidateSchema` has no
    // `phase` field, so this is the ONLY place phase 1 is stamped.
    // `advanceJobForRun` stamps phase 2 itself when a SWEEP_THEN_TUNE job's
    // phase 1 exhausts.
    const phase1Candidates: Candidate[] = requestedCandidates.map((c) => ({
      ...c,
      phase: 1,
    }));

    // Cast in its OWN declaration, not inline inside `.create()`'s `data`
    // literal: an inline `as unknown as X` on one field of that literal was
    // observed to collapse Prisma's generic return-type inference for the
    // WHOLE call to `any` (silent under `tsc`, caught by
    // `@typescript-eslint/no-unsafe-*` at every later use of the result).
    // Not a schema mismatch: `Candidate.hyperparameters` is typed
    // `Record<string, unknown>` for READ-side flexibility (`job.candidates
    // as unknown as Candidate[]` elsewhere in this file), which Prisma's
    // recursive Json input type cannot verify structurally on write. Every
    // value in it already came from `HyperparametersSchema`
    // (string/number/boolean/null only).
    const candidatesJson =
      phase1Candidates as unknown as PrismaTypes.InputJsonValue;

    let job: PrismaModels.ModelCandidateJobModel;
    try {
      job = await this.prisma.modelCandidateJob.create({
        data: {
          modelDraftId: draftId,
          targetY: dto.targetY,
          goldArtifactId: dto.goldArtifactId,
          trainTestSplit: dto.trainTestSplit ?? null,
          kind: dto.kind,
          candidates: candidatesJson,
          totalRuns: phase1Candidates.length,
          createdById: userId,
          status: 'QUEUED',
        },
      });
    } catch (err) {
      // The partial unique index (one QUEUED/RUNNING job per draft,
      // migration 20260825030923, recreated under its new name by
      // 20260827120000_model_flow_013_candidate_job) is the actual
      // guarantee — this only turns its generic P2002 into a message naming
      // the real constraint, same discipline MODEL-SERVE-001-T02's own note
      // gives for its single-PRODUCTION index. Unlike
      // dataset-draft.authorized.service.ts's recorded untranslated-P2002
      // precedent, this race is REACHABLE (a double-click on Start
      // Training/Find Best Model), not provably-unreachable-today.
      if (this.isUniqueViolation(err)) {
        throw new AppException({
          statusCode: 409,
          message: `Draft ${draftId} already has a candidate job in progress.`,
          type: 'ERROR',
        });
      }
      throw err;
    }

    try {
      const firstRun = await this.launchForJob(job, phase1Candidates[0]);
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
        message: 'Candidate job created',
        type: 'SUCCESS' as const,
        data: updated,
      };
    } catch (err) {
      // The job row would otherwise be stranded QUEUED with no run and no
      // way to advance. Marking FAILED also frees the partial unique index
      // immediately, so a bad first candidate does not block the user from
      // starting over.
      await this.prisma.modelCandidateJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          failureReason: `Could not launch the first run: ${(err as Error).message}`,
          finishedAt: new Date(),
        },
      });
      throw err;
    }
  }

  /**
   * Advance (or fail) a job given one of its runs just reached a terminal
   * status. See this class's own doc comment for the two call sites and why
   * calling this twice for the same run is safe.
   *
   * MODEL-FLOW-013-T11. For a SWEEP_THEN_TUNE job, exhausting the CURRENTLY
   * KNOWN candidates does not always mean the job is done: the first time
   * that happens (no candidate carries `phase: 2` yet), this appends a
   * phase-2 group — tuning variants of the phase-1 winner, from
   * `tuningCandidatesFor` — to the SAME `candidates` array and launches the
   * first one, inside the SAME compare-and-swap `updateMany` the two
   * existing branches already use. A job whose winner's algorithm has no
   * grid entry (should not happen — every algorithm `createJob` can accept
   * has one) falls through to the ordinary completion branch below, same as
   * a job whose phase-2 group is already present.
   */
  async advanceJobForRun(runId: string, jobId: string): Promise<void> {
    const [job, run] = await Promise.all([
      this.prisma.modelCandidateJob.findUnique({ where: { id: jobId } }),
      this.prisma.modelTrainingRun.findUnique({ where: { id: runId } }),
    ]);
    // Defensive only — the FK guarantees both exist once candidateJobId is
    // set on a real run.
    if (!job || !run) return;
    // Already advanced past this run (a concurrent caller won the race), or
    // the job already reached a terminal status.
    if (job.currentRunId !== runId) return;
    if (job.status !== 'QUEUED' && job.status !== 'RUNNING') return;

    if (run.status === 'FAILED' || run.status === 'CANCELED') {
      // MVP semantics: any candidate failure fails the WHOLE job. A
      // partial-tolerance mode (skip this candidate, try the next) is real
      // future scope, not built here — this ledger's own precedent is to
      // record a deferral rather than build speculative flexibility nobody
      // asked for.
      await this.prisma.modelCandidateJob.updateMany({
        where: {
          id: jobId,
          currentRunId: runId,
          status: { in: ['QUEUED', 'RUNNING'] },
        },
        data: {
          status: 'FAILED',
          failureReason:
            `Candidate ${job.completedRuns + 1} of ${job.totalRuns} ` +
            `${run.status.toLowerCase()}${run.failureReason ? `: ${run.failureReason}` : '.'}`,
          finishedAt: new Date(),
        },
      });
      return;
    }

    if (run.status !== 'SUCCEEDED') return; // still QUEUED/RUNNING — nothing to do yet.

    const rmse = this.extractRmse(run.metrics);
    const completedRuns = job.completedRuns + 1;
    // rmse, never r2: always present and well-behaved even for a degenerate
    // fit — an observed real run scored r2 = -1,110,858 while rmse stayed a
    // sane, comparable number (see MODEL-FLOW-004's own findings). Sound
    // across a varying-algorithm sweep too — MODEL-FLOW-013-T03's own note:
    // comparing RMSE across algorithms on one artifact/target/split is
    // exactly what makes them comparable at all.
    const isBetter =
      rmse !== null && (job.bestRmse === null || rmse < job.bestRmse);
    const candidates = job.candidates as unknown as Candidate[];

    if (completedRuns < candidates.length) {
      let nextRun: LaunchedRun;
      try {
        nextRun = await this.launchForJob(job, candidates[completedRuns]);
      } catch (err) {
        this.log.error(
          `candidate job ${job.id}: could not launch candidate ${completedRuns + 1} of ${candidates.length}`,
          err,
        );
        await this.prisma.modelCandidateJob.updateMany({
          where: {
            id: jobId,
            currentRunId: runId,
            status: { in: ['QUEUED', 'RUNNING'] },
          },
          data: {
            status: 'FAILED',
            failureReason: `Could not launch candidate ${completedRuns + 1} of ${candidates.length}: ${(err as Error).message}`,
            finishedAt: new Date(),
            completedRuns,
            ...(isBetter ? { bestRunId: run.id, bestRmse: rmse } : {}),
          },
        });
        return;
      }
      await this.prisma.modelCandidateJob.updateMany({
        where: {
          id: jobId,
          currentRunId: runId,
          status: { in: ['QUEUED', 'RUNNING'] },
        },
        data: {
          status: 'RUNNING',
          completedRuns,
          currentRunId: nextRun.id,
          ...(isBetter ? { bestRunId: run.id, bestRmse: rmse } : {}),
        },
      });
      return;
    }

    const finalBestRunId = isBetter ? run.id : job.bestRunId;
    const finalBestRmse = isBetter ? rmse : job.bestRmse;

    // MODEL-FLOW-013-T11. `!candidates.some(phase 2)` is the append-once
    // guard: once phase 2 exists, later calls for a PHASE-2 run's own
    // completion fall straight through to ordinary completion below,
    // exactly like an ALGORITHM_SWEEP job always has.
    if (
      job.kind === 'SWEEP_THEN_TUNE' &&
      finalBestRunId &&
      !candidates.some((c) => c.phase === 2)
    ) {
      const winnerRun =
        finalBestRunId === run.id
          ? run
          : await this.prisma.modelTrainingRun.findUnique({
              where: { id: finalBestRunId },
            });

      const tuneVariants = winnerRun
        ? tuningCandidatesFor(
            winnerRun.algorithm,
            (winnerRun.hyperparameters ?? {}) as Record<
              string,
              string | number | boolean | null
            >,
          )
        : [];

      if (winnerRun && tuneVariants.length > 0) {
        const phase2Candidates: Candidate[] = tuneVariants.map((hp) => ({
          algorithm: winnerRun.algorithm,
          hyperparameters: hp,
          phase: 2,
        }));
        const appendedCandidates = [...candidates, ...phase2Candidates];

        let tuneRun: LaunchedRun;
        try {
          tuneRun = await this.launchForJob(job, phase2Candidates[0]);
        } catch (err) {
          this.log.error(
            `candidate job ${job.id}: could not launch tuning candidate 1 of ${phase2Candidates.length}`,
            err,
          );
          await this.prisma.modelCandidateJob.updateMany({
            where: {
              id: jobId,
              currentRunId: runId,
              status: { in: ['QUEUED', 'RUNNING'] },
            },
            data: {
              status: 'FAILED',
              failureReason: `Could not launch tuning candidate 1 of ${phase2Candidates.length}: ${(err as Error).message}`,
              finishedAt: new Date(),
              completedRuns,
              bestRunId: finalBestRunId,
              bestRmse: finalBestRmse,
            },
          });
          return;
        }

        // Same reason `candidatesJson` above is its own declaration, not an
        // inline cast in the `data` literal.
        const appendedCandidatesJson =
          appendedCandidates as unknown as PrismaTypes.InputJsonValue;
        await this.prisma.modelCandidateJob.updateMany({
          where: {
            id: jobId,
            currentRunId: runId,
            status: { in: ['QUEUED', 'RUNNING'] },
          },
          data: {
            status: 'RUNNING',
            candidates: appendedCandidatesJson,
            totalRuns: appendedCandidates.length,
            completedRuns,
            currentRunId: tuneRun.id,
            bestRunId: finalBestRunId,
            bestRmse: finalBestRmse,
          },
        });
        return;
      }
    }

    // MODEL-SERVE-004. A MODEL-owned job (a retrain) completes by minting a
    // STAGING ModelVersion from its winner — see `completeModelOwnedJob` for
    // why that cannot be a second statement after the compare-and-swap.
    if (job.modelId) {
      await this.completeModelOwnedJob(
        { id: jobId, modelId: job.modelId },
        { runId, completedRuns, finalBestRunId, finalBestRmse },
      );
      return;
    }

    // Job complete.
    const result = await this.prisma.modelCandidateJob.updateMany({
      where: {
        id: jobId,
        currentRunId: runId,
        status: { in: ['QUEUED', 'RUNNING'] },
      },
      data: {
        status: 'SUCCEEDED',
        completedRuns,
        bestRunId: finalBestRunId,
        bestRmse: finalBestRmse,
        finishedAt: new Date(),
      },
    });
    if (result.count > 0 && finalBestRunId && job.modelDraftId) {
      // Point the draft at the metric's winner — the SAME single writer of
      // ModelDraft.currentRunId this branch has always been (MODEL-FLOW-013
      // -T08 does not add a second one: a later user selection writes
      // ModelCandidateJob.selectedRunId instead, resolved by callers as
      // `selectedRunId ?? bestRunId`, never by writing currentRunId again).
      await this.prisma.modelDraft.update({
        where: { id: job.modelDraftId },
        data: { currentRunId: finalBestRunId, status: 'TRAINED' },
      });
    }
  }

  /**
   * MODEL-SERVE-004-T04. The retrain counterpart of the draft branch above:
   * where a draft-owned job points its draft at the winner, a model-owned
   * job mints a new ModelVersion at STAGING from it — and promotes nothing.
   * No PRODUCTION pointer is read or written anywhere in this method; that
   * is the whole feature (V01).
   *
   * The compare-and-swap and the version create are ONE interactive
   * transaction, unlike the draft branch's two statements. The draft branch
   * can tolerate a crash between them (the draft simply is not flipped to
   * TRAINED, and the next read re-derives from the job); a retrain cannot —
   * `getJobService` only reconciles a job that is still QUEUED/RUNNING, so a
   * job left SUCCEEDED with `resultVersionId: null` would have lost its only
   * deliverable with nothing left to repair it.
   *
   * The manifest read (`getRunManifest`, an HTTP call to the Python service)
   * happens BEFORE the transaction opens — Save Model's own ordering, and the
   * reason is the same: a transaction must never be held open across a
   * network call to another service.
   *
   * Re-entrancy: `ModelVersion.sourceRunId` is `@unique`, so the winner can
   * back at most one version, ever. This checks for that row inside the
   * transaction and adopts it rather than racing the constraint — a retry
   * after a partially-observed completion links the existing version instead
   * of failing with a P2002 the caller cannot act on.
   */
  private async completeModelOwnedJob(
    job: { id: string; modelId: string },
    outcome: {
      runId: string;
      completedRuns: number;
      finalBestRunId: string | null;
      finalBestRmse: number | null;
    },
  ): Promise<void> {
    const { runId, completedRuns, finalBestRunId, finalBestRmse } = outcome;
    const terminal = {
      completedRuns,
      bestRunId: finalBestRunId,
      bestRmse: finalBestRmse,
      finishedAt: new Date(),
    };
    const swapWhere: PrismaTypes.ModelCandidateJobWhereInput = {
      id: job.id,
      currentRunId: runId,
      status: { in: ['QUEUED', 'RUNNING'] },
    };

    const winner = finalBestRunId
      ? await this.prisma.modelTrainingRun.findUnique({
          where: { id: finalBestRunId },
        })
      : null;

    // Every candidate ran and none produced a usable artifact. Recorded as a
    // FAILED job naming why, never as a SUCCEEDED job with no version — the
    // caller polling this job must be able to tell "your retrain produced
    // nothing" from "your retrain produced version N".
    if (!winner || !winner.modelKey) {
      await this.prisma.modelCandidateJob.updateMany({
        where: swapWhere,
        data: {
          ...terminal,
          status: 'FAILED',
          failureReason: winner
            ? `Winning run ${winner.id} recorded no model artifact; nothing to version.`
            : 'No candidate produced a usable result; nothing to version.',
        },
      });
      return;
    }

    // Best-effort, exactly as Save Model treats it: a run trained before the
    // manifest carried these fields has no honest value to fill in, and that
    // must not block the version.
    let frameworkVersions: Record<string, string> | null = null;
    let modelChecksum: string | null = null;
    if (winner.manifestKey) {
      try {
        const manifest = await getRunManifest(winner.manifestKey);
        frameworkVersions = manifest.framework_versions;
        modelChecksum = manifest.model_sha256 ?? null;
      } catch {
        frameworkVersions = null;
        modelChecksum = null;
      }
    }
    const modelObjectKey = winner.modelKey;

    await this.prisma.$transaction(async (tx) => {
      const swapped = await tx.modelCandidateJob.updateMany({
        where: swapWhere,
        data: { ...terminal, status: 'SUCCEEDED' },
      });
      // Lost the race to a concurrent caller — it is minting (or has minted)
      // the version. Do nothing, exactly as every other branch does.
      if (swapped.count === 0) return;

      const existing = await tx.modelVersion.findUnique({
        where: { sourceRunId: winner.id },
        select: { id: true },
      });
      const versionId =
        existing?.id ??
        (
          await tx.modelVersion.create({
            data: buildModelVersionData({
              modelId: job.modelId,
              version: await nextModelVersionNumber(tx, job.modelId),
              run: winner,
              modelObjectKey,
              modelChecksum,
              frameworkVersions,
            }),
            select: { id: true },
          })
        ).id;

      await tx.modelCandidateJob.update({
        where: { id: job.id },
        data: { resultVersionId: versionId },
      });
    });
  }

  /**
   * MODEL-FLOW-005-T06/V01/V04, widened by MODEL-FLOW-013-T06. Reconciles
   * before returning — a job whose fast-path nudge from `complete()` was
   * lost (process restart between the run's DB write and the nudge;
   * MODEL-FLOW-011-T04 tracks the identical gap for a single run) still
   * shows live truth on read, not a stale write. The response now also
   * shapes each candidate against its run (or `PENDING` if not yet
   * launched) — Model Selection (Step 4) needs every candidate's own
   * outcome, not just the job's aggregate state, and every value here is
   * resolved off the job/run rows, never the request, the same discipline
   * `getDraftRunPredictionsService` already applies.
   */
  async getJobService(
    draftId: string,
    jobId: string,
    userId: string,
    role: string,
  ) {
    await this.runLaunch.assertDraftReadable(draftId, userId, role);
    const found = await this.prisma.modelCandidateJob.findFirst({
      where: { id: jobId, modelDraftId: draftId },
    });
    if (!found) throw new NotFoundException('Candidate job not found');

    const { job, candidates } = await this.reconcileAndShape(found);
    return {
      statusCode: 200,
      message: 'Candidate job fetched',
      type: 'SUCCESS' as const,
      data: { ...job, candidates },
    };
  }

  /**
   * MODEL-SERVE-004. The reconcile-on-read + per-candidate table, split out
   * of `getJobService` so the retrain read
   * (`ModelRetrainAuthorizedService.getRetrainJobService`) shows the same
   * truth through the same code. ACCESS IS THE CALLER'S JOB — this method
   * takes a job row that has already been fetched under an authorization
   * check, and never performs one itself (the two owners authorize
   * differently: a draft by workspace membership on the draft, a Model by
   * editor access on the Model).
   */
  async reconcileAndShape(fetched: PrismaModels.ModelCandidateJobModel) {
    let job = fetched;
    if (
      (job.status === 'QUEUED' || job.status === 'RUNNING') &&
      job.currentRunId
    ) {
      const currentRun = await this.prisma.modelTrainingRun.findUnique({
        where: { id: job.currentRunId },
        select: { status: true },
      });
      if (
        currentRun &&
        (currentRun.status === 'SUCCEEDED' ||
          currentRun.status === 'FAILED' ||
          currentRun.status === 'CANCELED')
      ) {
        await this.advanceJobForRun(job.currentRunId, job.id);
        job = await this.prisma.modelCandidateJob.findUniqueOrThrow({
          where: { id: job.id },
        });
      }
    }

    const runs = await this.prisma.modelTrainingRun.findMany({
      where: { candidateJobId: job.id },
      orderBy: { createdAt: 'asc' },
    });
    const declared = job.candidates as unknown as Candidate[];
    // Launch order is array order — one candidate in flight or launched at a
    // time — so index alignment holds; still matched by position rather
    // than assumed by count in case a candidate never got a run (a launch
    // failure fails the whole job before advancing the index further).
    //
    // MODEL-FLOW-013-T07. A candidate's own lossHistoryKey is only a
    // pointer — the CLIENT's chart needs the actual series, so this reads
    // it here, once per candidate that has one, in parallel. A read
    // failure is soft: it logs and falls back to null rather than failing
    // the whole job fetch over one candidate's chart data (this endpoint's
    // job is the job's status and metrics first, a chart second).
    const candidates = await Promise.all(
      declared.map(async (candidate, i) => {
        const run = runs[i] ?? null;
        const metrics = (run?.metrics ?? null) as Record<
          string,
          unknown
        > | null;

        let lossHistory: {
          algorithm: string;
          metric: string;
          series: Record<string, number[]>;
        } | null = null;
        if (run?.lossHistoryKey) {
          try {
            // MODEL-SERVE-004. The STORED key, not one rebuilt from the
            // draft id: `complete()` wrote it through `buildRunKey(owner,…)`,
            // so it is already correct for either owner. Rebuilding it as
            // `draftRunKey(job.modelDraftId, …)` — what this line used to do
            // — yields `drafts/null/runs/…` for a model-owned (retrain) job,
            // which soft-fails to null and silently shows no loss history at
            // all. Same "read the pinned key, never re-derive it" discipline
            // MODEL-SERVE-000-T03 established for featureSpecKey.
            lossHistory = await getRunLossHistory(run.lossHistoryKey);
          } catch (err) {
            this.log.error(
              `candidate job ${job.id}: could not read loss history for run ${run.id}`,
              err,
            );
          }
        }

        return {
          runId: run?.id ?? null,
          algorithm: candidate.algorithm,
          hyperparameters: candidate.hyperparameters,
          // MODEL-FLOW-013-T11. Absent on a row written before phase
          // existed — every reader treats that as phase 1.
          phase: candidate.phase ?? 1,
          status: run?.status ?? ('PENDING' as const),
          failureReason: run?.failureReason ?? null,
          metrics: metrics
            ? {
                r2: metrics.r2 ?? null,
                rmse: metrics.rmse ?? null,
                mae: metrics.mae ?? null,
              }
            : null,
          trainMetrics: metrics
            ? {
                r2: metrics.train_r2 ?? null,
                rmse: metrics.train_rmse ?? null,
                mae: metrics.train_mae ?? null,
              }
            : null,
          lossHistoryKey: run?.lossHistoryKey ?? null,
          lossHistory,
          // MODEL-FLOW-017-T03. Pointers only, same "key on the response,
          // read the object separately" shape `lossHistoryKey` already
          // uses — the client resolves its OWN batch of runIds from
          // `predictionsKey !== null` and fetches every series in one call
          // (GET .../runs/predictions/batch), rather than this endpoint
          // reading N predictions.parquet objects inline the way it does
          // for loss history (a chart's full series is much larger than a
          // loss curve's few hundred floats — not a read worth doing here
          // on every job poll). `cvFoldsKey`/`scoringContainerId` travel
          // alongside so the client can tell a CV candidate's scored
          // predictionsKey (a holdout) from a non-CV candidate's (a test
          // split) — see MODEL-FLOW-016 AC5's 2026-09-04 amendment.
          predictionsKey: run?.predictionsKey ?? null,
          cvFoldsKey: run?.cvFoldsKey ?? null,
          scoringContainerId: run?.scoringContainerId ?? null,
        };
      }),
    );

    return { job, candidates };
  }

  /**
   * MODEL-FLOW-005-T08. Only a FAILED job can be retried, and only by
   * relaunching the SAME candidate that failed — `completedRuns` was
   * deliberately NOT incremented on failure (see `advanceJobForRun`), so
   * `candidates[completedRuns]` is exactly that candidate. Retry does not
   * know or care WHY it failed — a bad hyperparameter value, an
   * incompatible algorithm, and a transient container spawn failure all
   * look identical here, all get one more attempt at the operator's
   * request.
   *
   * NOT covered: a job stuck RUNNING because its current run itself is
   * orphaned (a nest --watch restart killed the in-memory container
   * tracker mid-flight — MODEL-FLOW-003-V01's own observed incident). This
   * retry path only fires on FAILED; recovering a genuinely stuck RUNNING
   * run needs the same boot-reconciliation MODEL-FLOW-011-T04 already
   * tracks, not a second copy of it here.
   */
  async retryJobService(
    draftId: string,
    jobId: string,
    userId: string,
    role: string,
  ) {
    await this.runLaunch.assertDraftWritable(draftId, userId, role);
    const job = await this.prisma.modelCandidateJob.findFirst({
      where: { id: jobId, modelDraftId: draftId },
    });
    if (!job) throw new NotFoundException('Candidate job not found');
    if (job.status !== 'FAILED') {
      throw new AppException({
        statusCode: 400,
        message: `Job is ${job.status}, not FAILED — nothing to retry.`,
        type: 'ERROR',
      });
    }

    const candidates = job.candidates as unknown as Candidate[];
    const retryIndex = job.completedRuns;
    if (retryIndex >= candidates.length) {
      throw new AppException({
        statusCode: 400,
        message: 'No candidate left to retry.',
        type: 'ERROR',
      });
    }

    let newRun: LaunchedRun;
    try {
      newRun = await this.runLaunch.launchDraftRun(
        draftId,
        this.runDtoFor(job, candidates[retryIndex]),
        job.id,
      );
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        throw new AppException({
          statusCode: 409,
          message: `Draft ${draftId} already has a candidate job in progress.`,
          type: 'ERROR',
        });
      }
      throw err;
    }

    const updated = await this.prisma.modelCandidateJob.update({
      where: { id: job.id },
      data: {
        status: 'RUNNING',
        currentRunId: newRun.id,
        failureReason: null,
        finishedAt: null,
      },
    });
    return {
      statusCode: 200,
      message: 'Candidate job retried',
      type: 'SUCCESS' as const,
      data: updated,
    };
  }

  /**
   * MODEL-FLOW-013-T08. Writes ONLY `selectedRunId` — never
   * `ModelDraft.currentRunId`, which keeps its single existing writer
   * (`advanceJobForRun`'s completion branch, above). Refuses while the job
   * is not terminal (a mid-sweep selection has no coherent meaning — the
   * candidate list is still growing) and refuses a `runId` that is not one
   * of this job's own SUCCEEDED runs, so a selection can never point
   * Evaluation/Save-Model-adoption at a run from a different job or draft.
   */
  async selectCandidateService(
    draftId: string,
    jobId: string,
    dto: SelectCandidateDto,
    userId: string,
    role: string,
  ) {
    await this.runLaunch.assertDraftWritable(draftId, userId, role);
    const job = await this.prisma.modelCandidateJob.findFirst({
      where: { id: jobId, modelDraftId: draftId },
    });
    if (!job) throw new NotFoundException('Candidate job not found');
    if (job.status !== 'SUCCEEDED' && job.status !== 'FAILED') {
      throw new AppException({
        statusCode: 400,
        message: `Job is ${job.status}, not terminal — selection is only meaningful once every candidate has a result.`,
        type: 'ERROR',
      });
    }

    const run = await this.prisma.modelTrainingRun.findFirst({
      where: { id: dto.runId, candidateJobId: jobId },
      select: { status: true },
    });
    if (!run) {
      throw new AppException({
        statusCode: 400,
        message: `${dto.runId} is not a candidate of this job.`,
        type: 'ERROR',
      });
    }
    if (run.status !== 'SUCCEEDED') {
      throw new AppException({
        statusCode: 400,
        message: `${dto.runId} is ${run.status}, not SUCCEEDED — cannot be selected.`,
        type: 'ERROR',
      });
    }

    // MODEL-FLOW-018-T02. A job-level selection is a NEWER, more specific
    // choice than any standalone one — `ModelDraft.selectedRunId` is
    // cleared in the same transaction so `resolveActiveRunId`'s source 1
    // can never shadow this one. The `job2.modelDraftId` check is DEFENSIVE
    // rather than reachable today: the lookup above already filters on
    // `modelDraftId: draftId`, a real (non-null) route param, so `job2` is
    // always draft-owned here — a retrain (MODEL-SERVE-004) job can never
    // be found by this query and never reaches this line. Kept in case a
    // future caller changes that lookup.
    const updated = await this.prisma.$transaction(async (tx) => {
      const job2 = await tx.modelCandidateJob.update({
        where: { id: jobId },
        data: { selectedRunId: dto.runId },
      });
      if (job2.modelDraftId) {
        await tx.modelDraft.update({
          where: { id: job2.modelDraftId },
          data: { selectedRunId: null },
        });
      }
      return job2;
    });
    return {
      statusCode: 200,
      message: 'Candidate selected',
      type: 'SUCCESS' as const,
      data: updated,
    };
  }
}
