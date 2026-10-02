import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService, PrismaTypes, PrismaModels } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import { ModelCandidateJobAuthorizedService } from './model-candidate-job.authorized.service';
import { ModelRetrainAugmentAuthorizedService } from './model-retrain-augment.authorized.service';
import type { TriggerRetrainDto } from './dto/model-retrain.authorized.dto';
import { usesNewData } from './dto/model-retrain.authorized.dto';
import type { DatasetSize } from '@/lib/tuning-grid';
import { postToPython, PYTHON_TIMEOUT } from '@/lib/python-client';
import { PythonSplitStatsSchema } from '../../dataset-version/authorized/dto/dataset-version.authorized.dto';

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

/**
 * MODEL-SERVE-019-T03/D02. The evaluation basis a single metric figure was
 * computed on, published BESIDE that figure — never a number alone. `from`/
 * `to`/`rowCount` are read from persisted rows only (never reconstructed);
 * any one of them can be `null` alongside a stated `unavailableReason` when
 * the fact was never recorded (a job created before this feature, or a
 * freeze call that failed). `usedFor` names what the figure actually does —
 * ranks candidates, is compared against the current production version, or
 * is reported on its own — so the UI states that role rather than implying
 * every figure means the same thing.
 */
export interface EvalBasis {
  frame:
    | 'MERGED_TEST_SPLIT'
    | 'FROZEN_INCUMBENT_TEST'
    | 'NEW_DATA_WINDOW'
    | 'INCUMBENT_TEST_SPLIT';
  from: string | null;
  to: string | null;
  rowCount: number | null;
  usedFor: 'RANK_CANDIDATES' | 'COMPARE_TO_PRODUCTION' | 'REPORT_ONLY';
  unavailableReason: string | null;
}

/** The merged training composition MODEL-SERVE-015-T05 left stranded: the
 *  combined artifact's own row counts, read off `DatasetArtifact.operations`
 *  and `DatasetArtifact.rowCount` — never recomputed client-side. */
export interface TrainingComposition {
  baseTrainRowCount: number | null;
  newTrainRowCount: number | null;
  dedupeDropped: number | null;
  cutTimestamp: string | null;
  combinedRowCount: number | null;
  /** What the candidate was actually FIT on, off its own recorded
   *  `splitSpec` — as opposed to what the combined artifact CONTAINS. The
   *  trainer re-splits the combined artifact chronologically by ratio, so the
   *  newest rows (the new data) land in the test split; on every real job
   *  checked, none of the new rows were in the fit. */
  fitRowCount: number | null;
  /** The instant the fit stops (the split's own cut). Rows at/after it were
   *  used only for testing. */
  fitUpTo: string | null;
  /** True/false when the persisted facts settle whether ANY new-data row was
   *  in the fit; null when they cannot (a job that recorded neither the new
   *  data's start nor a fit boundary past the base cut). Never guessed. */
  newDataUsedInFit: boolean | null;
}

/** `2025-11-06 19:00:00` (python's naive wall-clock str) or ISO -> epoch ms,
 *  or null. Both are wall-clock in the same zone, so they compare directly. */
function wallMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(`${value.replace(' ', 'T').replace(/Z$/, '')}Z`);
  return Number.isFinite(ms) ? ms : null;
}

/** The one entry `buildCombinedArtifact` writes onto the combined GOLD's
 *  `operations` column — untyped Json on the row, narrowed here rather than
 *  re-validated, the same convention `splitSpec`/`incumbentSplit` already
 *  use on this file's other Json columns. */
interface CombineOperationsEntry {
  cutTimestamp?: string | null;
  frozenEvalTo?: string | null;
  combinedEndTime?: string | null;
  frozenEvalDroppedRows?: number | null;
  baseTrainRowCount?: number | null;
  newTrainRowCount?: number | null;
  dedupeDropped?: number | null;
  newValidationRowCount?: number | null;
}

/** `PythonSplitStatsSchema`'s own shape, narrowed to the two fields this
 *  file reads off it — a run's or a job's frozen test-split basis. */
interface RunSplitStatsShape {
  cut_timestamp?: string | null;
  test_labelled_rows?: number | null;
}

/** Key-order-independent JSON, so `{a:1,b:2}` and `{b:2,a:1}` compare equal. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b),
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * MODEL-SERVE-026-T06. Custom Finetune's candidate list with "B" — the
 * current version's own configuration refitted on the new data — first.
 * Not added twice: when the operator's own candidate IS the current
 * configuration, the list is returned as given.
 */
export function withCurrentSettingsFirst<
  C extends { algorithm: string; hyperparameters: Record<string, unknown> },
>(
  requested: C[],
  current: { algorithm: string; hyperparameters: Record<string, unknown> },
  include: boolean,
): Array<C | typeof current> {
  if (!include) return requested;
  const same = (c: C) =>
    c.algorithm === current.algorithm &&
    canonicalJson(c.hyperparameters) === canonicalJson(current.hyperparameters);
  return requested.some(same) ? requested : [current, ...requested];
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
    private readonly augment: ModelRetrainAugmentAuthorizedService,
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
   * MODEL-FLOW-024. The size figures the incumbent was trained under, read off
   * the candidate job that produced its source run
   * (`ModelTrainingRun.candidateJobId` -> `sizedRowCount` /
   * `sizedDistinctLabelled`, which Step 3 filled from its own /split-stats
   * or, for the row count alone, the dataset's own count before Apply).
   * A DB row, never the artifact: a fresh count would mean re-reading the
   * artifact, which the trigger path has no business paying for.
   *
   * `undefined` when there is nothing to inherit — a run that was not part of
   * a job (a plain single run), a job whose row was deleted (`onDelete:
   * SetNull` clears the link), or a job started before Step 3's Apply — and
   * the search then resolves to the medium grid, exactly what a retrain did
   * before sizing existed.
   *
   * For AUGMENT_DATA the inherited figure describes the BASE dataset, so it
   * understates the combined artifact by however many new rows the added
   * data brings. That errs toward the smaller-capacity tier, the safe
   * direction, and is recorded rather than recomputed: a recompute is a full
   * read of the combined artifact.
   */
  private async sizeOfSourceRun(sourceRun: {
    candidateJobId: string | null;
  }): Promise<DatasetSize | undefined> {
    if (!sourceRun.candidateJobId) return undefined;
    const job = await this.prisma.modelCandidateJob.findUnique({
      where: { id: sourceRun.candidateJobId },
      select: { sizedRowCount: true, sizedDistinctLabelled: true },
    });
    if (!job) return undefined;
    if (job.sizedRowCount === null && job.sizedDistinctLabelled === null) {
      return undefined;
    }
    return {
      distinctLabelled: job.sizedDistinctLabelled,
      rows: job.sizedRowCount,
    };
  }

  /**
   * MODEL-FLOW-024. The size a retrain's curated search runs at, for
   * `algorithm` on this Model's incumbent — what the Custom Finetune form
   * needs to preview the SAME variants an automatic retrain would try. Editor
   * access, like triggering: the figures describe a dataset the caller must
   * be able to work on. `{}` (the medium grid) when the Model has no
   * PRODUCTION version to inherit from — a preview has no reason to fail
   * over that.
   */
  async resolveTuningSizeService(
    modelId: string,
    algorithm: string,
    user: Auth.UserPayload,
  ): Promise<DatasetSize> {
    await this.assertModelAccess(modelId, user);
    const incumbent = await this.prisma.modelVersion.findFirst({
      where: { modelId, stage: 'PRODUCTION' },
    });
    if (!incumbent) return {};
    const sourceRun = await this.prisma.modelTrainingRun.findUnique({
      where: { id: incumbent.sourceRunId },
      select: { candidateJobId: true },
    });
    const inherited = sourceRun
      ? await this.sizeOfSourceRun(sourceRun)
      : undefined;
    return this.candidateJobs.withFeatureCount(
      algorithm,
      incumbent.goldArtifactId,
      inherited ?? {},
    );
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
    // Custom Finetune may name its own ratio; otherwise the current
    // version's is reused. `resolveSplit` still runs first either way — it is
    // also what refuses a cross-validated incumbent.
    const trainRatio = dto.trainTestSplit ?? split.ratio;

    // MODEL-SERVE-015/019. Idempotent-retry fast-path: a retry must not
    // re-run `assertCompatible`/re-combine a second time (AUGMENT_DATA/
    // NEW_DATA_ONLY) or fail the new-data-required refusal below
    // (KEEP_EXISTING) before reaching the DB's own idempotency check — that
    // check only fires AFTER a wasted Python round trip. MODEL-SERVE-019
    // widened this from "new-data strategies only" to ANY strategy: a retry
    // of an old KEEP_EXISTING job by its idempotencyKey must still return
    // that job, never a 422 for a strategy this call never chose. Checked
    // here, before any augmentation work or the refusal, exactly like a real
    // idempotent-POST short-circuit; the DB check remains the authoritative
    // backstop for a genuine race between two concurrent requests.
    if (dto.idempotencyKey) {
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

    // MODEL-SERVE-019-D01. Keep Existing Data is removed: a NEW retrain
    // always ingests new data. Refused in the SERVICE, not in zod — a zod
    // refusal would reject the idempotency replay above before it ever ran.
    // `'KEEP_EXISTING'` stays a valid enum value (historical rows still read
    // it; `usesNewData` still recognizes it) — it is simply no longer an
    // accepted CHOICE for a new trigger. Reverses the definition
    // `decisions.fine_tuning_undefined` gave MODEL-SERVE-004.
    if (dto.strategy === 'KEEP_EXISTING') {
      throw new AppException({
        statusCode: 422,
        message:
          'A retrain requires a new dataset — choose "Existing + new data" ' +
          'or "New data only". Retraining on the same data with no new ' +
          'rows is no longer supported.',
        type: 'ERROR',
      });
    }

    // MODEL-SERVE-015. The AUGMENT_DATA path's own training artifact — a
    // combined GOLD+FINAL pair minted BEFORE the job row, so the job's
    // `goldArtifactId` never points at a row that does not exist yet. Every
    // refusal here (assertCompatible) costs nothing beyond a few metadata
    // reads; only buildCombinedArtifact spends the real Python round trip.
    let augmentedArtifact: Awaited<
      ReturnType<ModelRetrainAugmentAuthorizedService['buildCombinedArtifact']>
    > | null = null;
    let augmentCtx: Awaited<
      ReturnType<ModelRetrainAugmentAuthorizedService['assertCompatible']>
    > | null = null;
    if (usesNewData(dto.strategy)) {
      // .strict() + the DTO's own refine already guarantee this is set.
      augmentCtx = await this.augment.assertCompatible(
        sourceRun,
        dto.additionalDatasetVersionId!,
        // The DTO's own refinements already guarantee these are both set or
        // both absent, and that they appear only on a new-data strategy.
        dto.newValidationFrom && dto.newValidationTo
          ? { from: dto.newValidationFrom, to: dto.newValidationTo }
          : undefined,
        // MODEL-SERVE-021. Which overlap rule applies — see
        // `assertCompatible`'s own comment.
        dto.strategy === 'NEW_DATA_ONLY' ? 'NEW_DATA_ONLY' : 'AUGMENT_DATA',
      );
      // MODEL-SERVE-017. Both new-data strategies run the IDENTICAL
      // compatibility gate — same tags, same target, and above all the
      // cut-timestamp guard, which NEW_DATA_ONLY needs even more than
      // AUGMENT_DATA does: it is what keeps the incumbent's frozen
      // evaluation rows out of the candidate's training data. Only the
      // concatenation differs.
      augmentedArtifact = await this.augment.buildCombinedArtifact(
        augmentCtx,
        user,
        dto.strategy === 'AUGMENT_DATA',
      );
      // MODEL-SERVE-026-T05. The fold cap, at CONFIG time: measured on the
      // frame the candidates will actually train on (only now known — the
      // combine is what cuts it), and before the job row exists, so a refused
      // k never spawns a container.
      if (dto.cvFolds) {
        await this.assertCvFoldsAdmissible(
          augmentedArtifact.combinedObjectKey,
          sourceRun.targetY,
          trainRatio,
          dto.cvFolds,
        );
      }
    }

    // Candidates: the operator's own list, or the incumbent's configuration
    // expanded through the SAME curated grid the wizard's search uses. Either
    // way every candidate shares the incumbent's artifact, target and split —
    // that shared basis is what makes T05's comparison a real comparison.
    // (AUGMENT_DATA candidates share the COMBINED artifact instead — the
    // basis that changes is training data, never algorithm/hyperparameters.)
    //
    // MODEL-FLOW-024. The automatic search is SIZED, from the figures the
    // incumbent's own job recorded (see `sizeOfSourceRun`), so a retrain tunes
    // in the same tier the wizard's Find Best Parameters did instead of always
    // falling back to the medium grid. Custom candidates skip the expansion
    // and so the feature-count lookup; the inherited figures are still carried
    // onto the new job row below so the NEXT retrain can inherit them in turn.
    const trainingArtifactId =
      augmentedArtifact?.combinedFinalArtifactId ?? incumbent.goldArtifactId;
    const inherited = await this.sizeOfSourceRun(sourceRun);
    // MODEL-SERVE-017. `sizeOfSourceRun` returns the INCUMBENT's figures, and
    // its own comment justifies that for AUGMENT_DATA on the grounds that a
    // base-sized figure UNDERSTATES the combined artifact — the safe
    // direction, since it picks a smaller-capacity grid tier.
    //
    // NEW_DATA_ONLY inverts that argument exactly. The base figure now
    // OVERSTATES what the candidate trains on — a 26,280-row incumbent plus a
    // 500-row new range would size the search at the `large` tier and fit
    // 800-tree, depth-30 forests to 500 rows. So this path uses the row count
    // of the artifact actually being trained on, which Python already
    // returned and `buildCombinedArtifact` recorded; no extra read. The
    // inherited `distinctLabelled` is dropped rather than carried, because it
    // describes the base dataset's labels and nothing here re-derives it.
    const inheritedSize =
      dto.strategy === 'NEW_DATA_ONLY' && augmentedArtifact
        ? { rows: augmentedArtifact.combinedRowCount, distinctLabelled: null }
        : inherited;
    const searchSize = dto.candidates
      ? undefined
      : await this.candidateJobs.withFeatureCount(
          incumbent.algorithm,
          trainingArtifactId,
          inheritedSize ?? {},
        );
    // MODEL-SERVE-026-T06. "B": the current version's OWN configuration
    // (read off its version row, never client defaults), refitted on the new
    // data. Auto Finetune has always tried it first (`expandSearchCandidates`
    // returns `[base, ...variants]`); Custom Finetune now does too, unless
    // the operator opts out — without B a retrain cannot say whether its
    // change came from the data or from the settings.
    const currentSettings = {
      algorithm: incumbent.algorithm,
      hyperparameters: (incumbent.hyperparameters ?? {}) as Record<
        string,
        unknown
      >,
    };
    const requested = dto.candidates
      ? withCurrentSettingsFirst(
          dto.candidates,
          currentSettings,
          dto.refitCurrentSettings !== false,
        )
      : this.candidateJobs.expandSearchCandidates(currentSettings, searchSize);
    const candidates = requested.map((candidate) => ({
      ...candidate,
      phase: 1,
    }));

    // Own declaration, never an inline cast in the `data` literal — an inline
    // `as unknown as X` on one field collapses Prisma's generic return-type
    // inference for the whole call to `any` (see createJob's own note).
    const candidatesJson = candidates as unknown as PrismaTypes.InputJsonValue;
    // MODEL-SERVE-026-T07. Omitted (not JSON null) when none were chosen,
    // so the column stays SQL NULL — "none chosen", like every older job.
    const criteriaJson = dto.acceptanceCriteria?.length
      ? (dto.acceptanceCriteria as unknown as PrismaTypes.InputJsonValue)
      : undefined;

    let job: PrismaModels.ModelCandidateJobModel;
    try {
      job = await this.prisma.modelCandidateJob.create({
        data: {
          modelId,
          sourceVersionId: incumbent.id,
          idempotencyKey: dto.idempotencyKey ?? null,
          targetY: sourceRun.targetY,
          goldArtifactId: trainingArtifactId,
          // MODEL-FLOW-024. Inherited from the incumbent's own job, so the
          // chain of retrains keeps its figures (a retrain job's row is the
          // next retrain's `sourceRun.candidateJobId` target). Omitted, not
          // nulled, when there was nothing to inherit.
          ...(inheritedSize
            ? {
                sizedRowCount: inheritedSize.rows ?? null,
                sizedDistinctLabelled: inheritedSize.distinctLabelled ?? null,
              }
            : {}),
          trainTestSplit: trainRatio,
          cvFolds: dto.cvFolds ?? null,
          ...(criteriaJson ? { acceptanceCriteria: criteriaJson } : {}),
          kind: 'HYPERPARAMETER_SEARCH',
          candidates: candidatesJson,
          totalRuns: candidates.length,
          createdById: user.id,
          status: 'QUEUED',
          ...(augmentedArtifact && augmentCtx
            ? {
                // The strategy actually requested, not a hardcoded literal —
                // NEW_DATA_ONLY must not be recorded as AUGMENT_DATA, or the
                // comparison UI would claim the candidate trained on the
                // incumbent's rows when it deliberately did not.
                retrainStrategy: dto.strategy,
                baseDatasetVersionId: augmentCtx.baseDatasetVersionId,
                additionalDatasetVersionId: augmentCtx.newDatasetVersionId,
                combinedArtifactId: augmentedArtifact.combinedFinalArtifactId,
              }
            : {}),
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

    // MODEL-SERVE-019. Job-level split stats, new-data strategies only (see
    // `freezeJobSplitStats`'s own comment). Fire-and-forget, after the job
    // row is durable — never inside this request path.
    if (augmentedArtifact) {
      this.freezeJobSplitStats(
        job.id,
        augmentedArtifact.combinedObjectKey,
        sourceRun.targetY,
        trainRatio,
      );
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
          'validation. Retrain reuses that same split, and a CV ' +
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

  /**
   * MODEL-SERVE-026-T05. REFUSE, DO NOT DEGRADE — the same rule
   * MODEL-FLOW-016 applies to a wizard CV run, at the same point (config
   * time) and from the same measurement (`/split-stats`' own
   * `max_admissible_k` = distinct labelled values // 10, measured, not
   * picked). Synchronous ON PURPOSE, unlike `freezeJobSplitStats` below: its
   * answer decides whether the job may exist at all. The trainer's
   * `assert_admissible_fold_count` stays as the fit-time backstop.
   */
  private async assertCvFoldsAdmissible(
    objectKey: string,
    targetY: string,
    ratio: number,
    cvFolds: number,
  ): Promise<void> {
    const stats = PythonSplitStatsSchema.parse(
      await postToPython(
        '/v1/preprocess/split-stats',
        {
          source_key: objectKey,
          tags: [targetY],
          target_y: targetY,
          split_ratio: ratio,
        },
        PYTHON_TIMEOUT.metadata,
      ),
    );
    if (cvFolds > stats.max_admissible_k) {
      throw new AppException({
        statusCode: 422,
        message:
          `${cvFolds} folds is more than this data supports: the new ` +
          `dataset's training rows carry ${stats.distinct_labelled_values} ` +
          'distinct target values, and each fold needs at least 10, so at ' +
          `most ${stats.max_admissible_k} folds are allowed.` +
          (stats.max_admissible_k < 2
            ? ' Run the retrain without cross-validation.'
            : ''),
        type: 'ERROR',
      });
    }
  }

  /**
   * MODEL-SERVE-019. The MERGED_TEST_SPLIT figure's own row count and time
   * range, frozen ONCE PER JOB — mirrors `freezeSplitStats`
   * (`model-run-launch.authorized.service.ts`) exactly: fire-and-forget,
   * called AFTER the job row is durable, never inside the trigger request
   * path (this same `/split-stats` call already runs at
   * `PYTHON_TIMEOUT.metadata` = 300,000ms there). A failure logs and leaves
   * `splitStats` null — the same honest-legacy-null pattern, and it can
   * never fail a retrain that has already started.
   *
   * Only called for a new-data strategy: KEEP_EXISTING trains on the
   * incumbent's own unchanged artifact, whose test split is already the
   * figure `ModelVersion.metrics`/the incumbent's own run describe — a
   * second read of the identical answer.
   */
  private freezeJobSplitStats(
    jobId: string,
    objectKey: string,
    targetY: string,
    ratio: number,
  ): void {
    void postToPython(
      '/v1/preprocess/split-stats',
      {
        source_key: objectKey,
        tags: [targetY],
        target_y: targetY,
        split_ratio: ratio,
      },
      PYTHON_TIMEOUT.metadata,
    )
      .then(async (raw) => {
        const splitStats = PythonSplitStatsSchema.parse(raw);
        await this.prisma.modelCandidateJob.update({
          where: { id: jobId },
          data: { splitStats },
        });
      })
      .catch((err) => {
        const reason = err instanceof Error ? err.message : String(err);
        this.log.warn(`freezeJobSplitStats failed for job ${jobId}: ${reason}`);
      });
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
   * MODEL-SERVE-014. The retrain trigger's response carries no persistent
   * discovery route of its own — a caller who reloads the page, or opens
   * Model Detail on a second tab, has no `jobId` to poll. Same shape as
   * `getRetrainJobService`, keyed off the model instead: the live
   * QUEUED/RUNNING job when one exists, else the most recent job ever run
   * for this model (so a completed retrain's result — the STAGING version,
   * the comparison — stays visible after it finishes), else `null` when the
   * model has never been retrained. No new orchestration — one extra read
   * before the existing reconcile-and-compare path.
   */
  async getCurrentRetrainJobService(modelId: string, user: Auth.UserPayload) {
    await this.assertModelAccess(modelId, user);

    // Resolved independently of any job: the Retrain dialog needs the
    // incumbent's algorithm to build a Custom fine-tune form, and needs to
    // know "no PRODUCTION version" BEFORE the user submits, not as a
    // rejected POST — neither is available from a job, since the first
    // retrain for a model has none yet.
    const incumbentVersion = await this.prisma.modelVersion.findFirst({
      where: { modelId, stage: 'PRODUCTION' },
      select: {
        id: true,
        version: true,
        algorithm: true,
        goldArtifactId: true,
        sourceDatasetId: true,
        // Custom Finetune's hyperparameter table starts from these.
        hyperparameters: true,
        // MODEL-SERVE-017. Carries the computed split boundary out to the
        // dialog — see `cutTimestamp` below. Also the ratio Custom Finetune
        // prefills its split control with.
        sourceRun: { select: { splitSpec: true } },
      },
    });
    // MODEL-SERVE-017. The incumbent's own computed split boundary. The
    // client needs it to CLAMP the new-data range picker: `assertCompatible`
    // refuses any dataset starting at or before this instant (it is what
    // keeps the frozen evaluation rows out of training), so offering an
    // earlier range would be offering a choice the server always rejects —
    // after a slow fetch, not before it. Null when the source run recorded
    // no boundary, which is the same condition `assertCompatible` itself
    // 422s on; the dialog then falls back to an unclamped picker and lets
    // the server speak.
    const splitSpec = incumbentVersion?.sourceRun?.splitSpec as {
      method?: string;
      ratio?: unknown;
      cut_timestamp?: string;
    } | null;
    const cutTimestamp = splitSpec?.cut_timestamp ?? null;
    // The ratio a retrain reuses when Custom Finetune names none. Null for a
    // cross-validated version (no single ratio — `resolveSplit` refuses it
    // at trigger time anyway) or an unreadable one; the form then falls back
    // to its own default.
    const trainTestSplit =
      splitSpec?.method !== 'cv_expanding' &&
      typeof splitSpec?.ratio === 'number' &&
      splitSpec.ratio > 0 &&
      splitSpec.ratio < 1
        ? splitSpec.ratio
        : null;
    // MODEL-SERVE-015-T01. The base dataset a data-augmentation retrain
    // would merge NEW data with — resolved off the incumbent's OWN pinned
    // artifact (`goldArtifactId`, one hop off the version, itself one hop
    // off the source run), NEVER off `Model.datasetId`: a dataset can be
    // renamed/re-versioned after training and that field can point
    // somewhere else entirely by the time a retrain is triggered. Null
    // whenever no incumbent exists, or its artifact's DatasetVersion row
    // was never created (a legacy row, or a draft-only artifact).
    const baseDataset = incumbentVersion
      ? await (async () => {
          const version = await this.prisma.datasetVersion.findFirst({
            where: { artifactId: incumbentVersion.goldArtifactId },
            select: { id: true, versionNumber: true },
          });
          const dataset = await this.prisma.dataset.findUnique({
            where: { id: incumbentVersion.sourceDatasetId },
            select: { id: true, name: true },
          });
          if (!dataset) return null;
          return {
            datasetId: dataset.id,
            datasetName: dataset.name,
            versionId: version?.id ?? null,
            versionNumber: version?.versionNumber ?? null,
          };
        })()
      : null;
    const incumbent = incumbentVersion
      ? {
          versionId: incumbentVersion.id,
          version: incumbentVersion.version,
          algorithm: incumbentVersion.algorithm,
          baseDataset,
          cutTimestamp,
          hyperparameters: (incumbentVersion.hyperparameters ?? null) as Record<
            string,
            unknown
          > | null,
          trainTestSplit,
        }
      : null;

    const live = await this.prisma.modelCandidateJob.findFirst({
      where: { modelId, status: { in: ['QUEUED', 'RUNNING'] } },
      orderBy: { createdAt: 'desc' },
    });
    const found =
      live ??
      (await this.prisma.modelCandidateJob.findFirst({
        where: { modelId },
        orderBy: { createdAt: 'desc' },
      }));

    if (!found) {
      return {
        statusCode: 200,
        message: 'No retrain job exists for this model',
        type: 'SUCCESS' as const,
        data: { incumbent, job: null },
      };
    }

    const { job, candidates } =
      await this.candidateJobs.reconcileAndShape(found);
    const comparison = await this.buildComparison(job);

    return {
      statusCode: 200,
      message: 'Current retrain job fetched',
      type: 'SUCCESS' as const,
      data: { incumbent, job: { ...job, candidates, comparison } },
    };
  }

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

    // MODEL-SERVE-015-T04. AUGMENT_DATA amends the comparability rule, it
    // does not drop it: the OLD invariant was "one basis, therefore one
    // artifact" (checked below via goldArtifactId/checksum/split equality).
    // The NEW one is "one EVALUATION basis; the training artifact may
    // differ" — a combined artifact differs from the incumbent's on
    // artifact/checksum BY CONSTRUCTION, so those checks would always fail
    // it. What proves the basis instead: the candidate's `evalSetKind` must
    // be `FROZEN_INCUMBENT_TEST` (scored via the passthrough holdout
    // channel on the incumbent's own frozen test rows, never re-derived —
    // see `ModelTrainingRun.evalSetKind`'s own comment) and it must carry a
    // `frozenEvalChecksum` (proves the scoring actually ran, never soft-
    // failed to null).
    // MODEL-SERVE-021 NARROWS THIS BACK TO AUGMENT_DATA ONLY. MODEL-SERVE-017
    // originally routed NEW_DATA_ONLY through this SAME frozen-slice rule —
    // true while it was still scored on the incumbent's own frozen test
    // rows. MODEL-SERVE-021 reverses that: NEW_DATA_ONLY now REPLACES the
    // training data outright (confirmed zero rows in the frozen slice would
    // even exist, since `combine_for_retrain` never carves one for this
    // strategy any more), so comparability comes from a wholly different
    // basis — see `isNewDataOnly` below — and `isAugmented` must go back to
    // naming ONLY the strategy this frozen-slice logic still applies to, or
    // it would push every NEW_DATA_ONLY candidate down a path whose
    // `evalSetKind`/`frozenEvalChecksum` it can no longer ever satisfy.
    const isAugmented = job.retrainStrategy === 'AUGMENT_DATA';
    // MODEL-SERVE-021. Scored inside the candidate's OWN training container
    // against the SAME operator-defined new-data window on both the
    // candidate and the incumbent's own saved model (`claim()`'s
    // `prepareNewDataOnlyComparison` presigns the incumbent; the trainer
    // scores both — see MIRRORS.md entry 10). No frozen slice, no merged
    // artifact: `combinedFinal`/`combinedArtifact` below are never fetched
    // for this strategy, since `trainingComposition` describes a
    // base+new MIX that a replace strategy never produces.
    const isNewDataOnly = job.retrainStrategy === 'NEW_DATA_ONLY';

    // MODEL-SERVE-019-T03. The extra rows every figure's basis is built
    // from — read only, never mutated, and only fetched when the strategy
    // that needs them is actually running.
    const [combinedFinal, incumbentJob] = await Promise.all([
      isAugmented && candidateRun?.goldArtifactId
        ? this.prisma.datasetArtifact.findUnique({
            where: { id: candidateRun.goldArtifactId },
          })
        : Promise.resolve(null),
      incumbentRun?.candidateJobId
        ? this.prisma.modelCandidateJob.findUnique({
            where: { id: incumbentRun.candidateJobId },
            select: { splitStats: true },
          })
        : Promise.resolve(null),
    ]);
    // MODEL-SERVE-020-T01 CORRECTION. A retrain candidate trains on the
    // combined FINAL artifact (`ModelTrainingRun.goldArtifactId` is the FINAL
    // id), but `buildCombinedArtifact` writes that FINAL row with
    // `operations: []` and NO validation-slice columns — `operations[0]`
    // (composition, cut/frozen-eval bounds, dropped rows) and
    // `validationRowCount`/`validationHoldoutFrom` live on its GOLD PARENT.
    // The first cut of this method read the FINAL directly, so on a real job
    // every basis was unavailable and the D03 gate always saw
    // `frozenEvalDroppedRows` as unrecorded — comparable=false for EVERY new
    // retrain. Unit tests passed because their artifact mock ignored the id.
    const combinedArtifact = combinedFinal?.parentArtifactId
      ? await this.prisma.datasetArtifact.findUnique({
          where: { id: combinedFinal.parentArtifactId },
        })
      : null;
    const combinedOps =
      (
        combinedArtifact?.operations as unknown as
          | CombineOperationsEntry[]
          | null
      )?.[0] ?? null;
    // A single-run launch freezes `splitStats` on the RUN itself; a
    // candidate run never does (see that column's own schema comment), so
    // the incumbent's JOB is the fallback source when its run was itself
    // one candidate among several.
    const incumbentSplitStats =
      (incumbentRun?.splitStats as RunSplitStatsShape | null) ??
      (incumbentJob?.splitStats as RunSplitStatsShape | null) ??
      null;
    const candidateSplitStats =
      (job.splitStats as RunSplitStatsShape | null) ?? null;

    const mismatches: string[] = [];
    if (!candidateRun) {
      mismatches.push('no candidate has produced a result yet');
    } else if (!incumbentRun) {
      mismatches.push(
        "the current production version's source run no longer exists",
      );
    } else if (isNewDataOnly) {
      // MODEL-SERVE-021. No frozen slice and no shared artifact to check —
      // the only thing that makes this comparison valid is that BOTH sides
      // were actually scored on the SAME validation window inside the
      // candidate's own training container.
      if (candidateRun.targetY !== incumbentRun.targetY) {
        mismatches.push('different target');
      }
      if (!candidateRun.newDataHoldoutMetrics) {
        mismatches.push(
          'the new version has not been scored on the validation window yet',
        );
      } else if (!candidateRun.incumbentNewDataHoldoutMetrics) {
        // Plain, no-jargon reason — covers both a genuine scoring failure
        // and the lstm/gru scope gap (`claim()` never presigns an incumbent
        // for a sequence algorithm; see MIRRORS.md entry 10).
        mismatches.push(
          'the current version could not be scored on the same validation window',
        );
      }
    } else if (isAugmented) {
      if (candidateRun.targetY !== incumbentRun.targetY) {
        mismatches.push('different target');
      }
      if (candidateRun.evalSetKind !== 'FROZEN_INCUMBENT_TEST') {
        mismatches.push(
          "not yet scored on the current production version's own test data",
        );
      } else if (!candidateRun.frozenEvalChecksum) {
        mismatches.push(
          "the current production version's test data could not be verified (missing checksum)",
        );
      } else {
        // MODEL-SERVE-019-D03. The candidate is scored on a RE-CUT slice
        // [cutTimestamp, new-data start) — a subset of the production
        // version's own full test split whenever the new dataset starts
        // before that split's own tail. `frozenEvalDroppedRows` (persisted
        // by combine_for_retrain) counts exactly how many rows were cut off
        // that tail; 0 means the frozen slice covers the SAME row extent
        // the production version's own test split does, both unmasked.
        //
        // NOT gated on comparing this artifact's `validationRowCount`
        // (unmasked) against the production run's own `test_labelled_rows`
        // (masked to the target's Good rows by `build_split_stats`) — those
        // two counts describe different populations and would disagree on
        // any sparse target regardless of whether the slice actually
        // matches, which would have refused the delta on nearly every real
        // model. `incumbentSplitStats` stays for DISPLAY (the basis label)
        // only, never for this gate.
        const droppedRows = combinedOps?.frozenEvalDroppedRows ?? null;
        if (droppedRows === null) {
          mismatches.push(
            'not recorded whether the current production version was tested on the same rows (this retrain predates that check)',
          );
        } else if (droppedRows > 0) {
          mismatches.push(
            `tested on fewer rows than the current production version's own test data (${droppedRows.toLocaleString()} row${droppedRows === 1 ? '' : 's'} not covered)`,
          );
        }
      }
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
    // (ModelVersion.metrics' own schema comment). MODEL-SERVE-021 EXCEPTS
    // NEW_DATA_ONLY: the version snapshot is the incumbent's score on ITS
    // OWN historical test split, a different population from the shared
    // validation window this strategy compares on — `incumbentNewDataHoldoutMetrics`
    // is scored fresh, inside the candidate's own run, on that window.
    const incumbentMetrics = isNewDataOnly
      ? metricTriple(candidateRun?.incumbentNewDataHoldoutMetrics ?? null)
      : metricTriple(incumbent.metrics);
    // AUGMENT_DATA compares against `holdoutMetrics` — the candidate's score
    // on the incumbent's OWN frozen test rows — never `metrics`, which is
    // the candidate's own test split over the COMBINED (mixed-regime) data
    // and answers a different question (T04's "report new dataset
    // evaluation separately", carried below as `newRegimeMetrics`).
    // NEW_DATA_ONLY compares against `newDataHoldoutMetrics` — the
    // candidate's score on the shared validation window, the only figure
    // this strategy has that is comparable to the incumbent at all.
    const candidateMetrics = metricTriple(
      isNewDataOnly
        ? (candidateRun?.newDataHoldoutMetrics ?? null)
        : isAugmented
          ? (candidateRun?.holdoutMetrics ?? null)
          : (candidateRun?.metrics ?? null),
    );
    // Null for NEW_DATA_ONLY: there is no "combined, mixed-regime" data to
    // report a second figure over — the candidate trained on the new
    // dataset alone.
    const newRegimeMetrics = isAugmented
      ? metricTriple(candidateRun?.metrics ?? null)
      : null;
    const rmseDelta =
      comparable &&
      candidateMetrics.rmse !== null &&
      incumbentMetrics.rmse !== null
        ? candidateMetrics.rmse - incumbentMetrics.rmse
        : null;

    // MODEL-SERVE-014-T06. The version the job actually minted, once it has
    // one — there is no versions-list endpoint to look this up from later,
    // so the retrain UI names it here or not at all.
    const candidateVersion = job.resultVersionId
      ? await this.prisma.modelVersion.findUnique({
          where: { id: job.resultVersionId },
          select: { version: true, stage: true },
        })
      : null;

    // MODEL-SERVE-019-T03/D02. One EvalBasis per figure, built from the
    // persisted rows fetched above — never reconstructed, never guessed.
    // `null` only for a figure the current strategy does not produce
    // (KEEP_EXISTING, still rendered for historical jobs) or a run whose
    // basis predates this feature.
    const incumbentTestBasis: EvalBasis = {
      frame: 'INCUMBENT_TEST_SPLIT',
      from: incumbentSplitStats?.cut_timestamp ?? null,
      // `PythonSplitStatsSchema` carries no upper bound for the test side —
      // only its row count and the cut that starts it. Left null rather than
      // guessed at.
      to: null,
      rowCount: incumbentSplitStats?.test_labelled_rows ?? null,
      usedFor: 'COMPARE_TO_PRODUCTION',
      unavailableReason: incumbentSplitStats
        ? null
        : "not recorded for the current production version's own run",
    };
    const frozenTestBasis: EvalBasis | null = isAugmented
      ? {
          frame: 'FROZEN_INCUMBENT_TEST',
          from: combinedOps?.cutTimestamp ?? null,
          to: combinedOps?.frozenEvalTo ?? null,
          rowCount: combinedArtifact?.validationRowCount ?? null,
          usedFor: 'COMPARE_TO_PRODUCTION',
          unavailableReason:
            combinedArtifact?.validationRowCount != null
              ? null
              : 'not recorded for this retrain',
        }
      : null;
    const mergedTestBasis: EvalBasis | null = isAugmented
      ? {
          frame: 'MERGED_TEST_SPLIT',
          from: candidateSplitStats?.cut_timestamp ?? null,
          to: combinedOps?.combinedEndTime ?? null,
          rowCount: candidateSplitStats?.test_labelled_rows ?? null,
          usedFor: 'RANK_CANDIDATES',
          unavailableReason: candidateSplitStats
            ? null
            : 'not recorded for this retrain (created before this figure was tracked, or the recording call failed)',
        }
      : null;
    const newDataWindowReason: string | null =
      candidateRun?.newDataHoldoutMetrics
        ? null
        : candidateRun?.newDataHoldoutRowCount == null
          ? combinedOps?.newValidationRowCount
            ? 'set aside, but not yet scored'
            : 'no new-data window was set aside for this retrain'
          : 'set aside, but the trainer did not score it';
    const newDataWindowBasis: EvalBasis | null = isAugmented
      ? {
          frame: 'NEW_DATA_WINDOW',
          from: candidateRun?.newDataHoldoutFrom?.toISOString() ?? null,
          to: candidateRun?.newDataHoldoutTo?.toISOString() ?? null,
          rowCount: candidateRun?.newDataHoldoutRowCount ?? null,
          usedFor: 'REPORT_ONLY',
          unavailableReason: newDataWindowReason,
        }
      : null;
    // MODEL-SERVE-021. The SAME frame as `newDataWindowBasis` above, but
    // `usedFor: 'COMPARE_TO_PRODUCTION'` rather than `'REPORT_ONLY'` — for
    // NEW_DATA_ONLY this window IS the comparison, not a figure reported
    // beside one. Reused as BOTH `candidate.metricsBasis` and
    // `incumbent.metricsBasis` below: the whole point of D01 is that both
    // sides were scored on the identical rows, so one basis object
    // describes both figures. No new `frame`/`usedFor` literal — both
    // already exist on `EvalBasis` for other figures.
    const newDataOnlyWindowBasis: EvalBasis | null = isNewDataOnly
      ? {
          frame: 'NEW_DATA_WINDOW',
          from: candidateRun?.newDataHoldoutFrom?.toISOString() ?? null,
          to: candidateRun?.newDataHoldoutTo?.toISOString() ?? null,
          rowCount: candidateRun?.newDataHoldoutRowCount ?? null,
          usedFor: 'COMPARE_TO_PRODUCTION',
          unavailableReason: !candidateRun?.newDataHoldoutMetrics
            ? 'the new version has not been scored on this window yet'
            : !candidateRun?.incumbentNewDataHoldoutMetrics
              ? 'the current version could not be scored on this window'
              : null,
        }
      : null;
    // MODEL-SERVE-015-T05. The merged training composition, stranded until
    // now inside DatasetArtifact.operations with no reader on this surface.
    // MODEL-SERVE-020. What the candidate was FIT on, from its own recorded
    // split — not from the artifact's contents. The new rows are the newest,
    // and the trainer splits chronologically, so they fall in the test split:
    // `newDataUsedInFit` is what stops the tab describing the artifact as if it
    // were the training set. The new data starts strictly after the base cut,
    // so a fit that stops at/before that cut provably used none of it; a fit
    // reaching past the new data's own start provably used some; anything
    // between is unknown (an older job that never recorded that start).
    const candidateSplit2 = candidateRun?.splitSpec as {
      train_rows?: number;
      cut_timestamp?: string;
    } | null;
    const fitUpTo = candidateSplit2?.cut_timestamp ?? null;
    const fitMs = wallMs(fitUpTo);
    const baseCutMs = wallMs(combinedOps?.cutTimestamp);
    const newStartMs = wallMs(combinedOps?.frozenEvalTo);
    const newDataUsedInFit =
      fitMs === null
        ? null
        : baseCutMs !== null && fitMs <= baseCutMs
          ? false
          : newStartMs !== null
            ? fitMs > newStartMs
            : null;
    const trainingComposition: TrainingComposition | null =
      isAugmented && combinedOps
        ? {
            baseTrainRowCount: combinedOps.baseTrainRowCount ?? null,
            newTrainRowCount: combinedOps.newTrainRowCount ?? null,
            dedupeDropped: combinedOps.dedupeDropped ?? null,
            cutTimestamp: combinedOps.cutTimestamp ?? null,
            combinedRowCount: combinedArtifact?.rowCount ?? null,
            fitRowCount:
              typeof candidateSplit2?.train_rows === 'number'
                ? candidateSplit2.train_rows
                : null,
            fitUpTo,
            newDataUsedInFit,
          }
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
        // MODEL-SERVE-015-T04. Which invariant `comparable` is actually
        // proving — 'KEEP_EXISTING' means one shared artifact/checksum/
        // split; 'AUGMENT_DATA' means the candidate was scored on the
        // incumbent's own frozen test rows regardless of what it trained
        // on. The UI must state which basis a delta belongs to (plan's own
        // requirement) rather than imply one universal meaning of
        // "comparable".
        strategy: (job.retrainStrategy ?? 'KEEP_EXISTING') as
          | 'KEEP_EXISTING'
          | 'AUGMENT_DATA'
          | 'NEW_DATA_ONLY',
        // Null for NEW_DATA_ONLY: there is no frozen-slice `evalSetKind` any
        // more (MODEL-SERVE-021) — its own basis is `newDataOnlyWindowBasis`
        // above, carried on `incumbent.metricsBasis`/`candidate.metricsBasis`
        // instead.
        evalSet: isAugmented
          ? ({
              kind: candidateRun?.evalSetKind ?? null,
              checksum: candidateRun?.frozenEvalChecksum ?? null,
            } as const)
          : null,
        // MODEL-SERVE-019-T03. Closes 015-T05's stranded "combined row
        // count" acceptance criterion — null for KEEP_EXISTING, which never
        // combines anything.
        trainingComposition,
      },
      incumbent: {
        versionId: incumbent.id,
        version: incumbent.version,
        stage: incumbent.stage,
        algorithm: incumbent.algorithm,
        // MODEL-SERVE-020-T05. The run the current version was trained by —
        // the Retrain tab reads its test predictions (Model-scoped route) to
        // overlay the current version on the charts. Already resolved above
        // (`incumbent.sourceRunId` is how `incumbentRun` is fetched).
        sourceRunId: incumbent.sourceRunId,
        metrics: incumbentMetrics,
        // MODEL-SERVE-021. NEW_DATA_ONLY's incumbent figure is scored on the
        // shared validation window, not the incumbent's own historical test
        // split — `incumbentTestBasis` would describe the wrong population
        // for the number actually shown above.
        metricsBasis: isNewDataOnly
          ? newDataOnlyWindowBasis
          : incumbentTestBasis,
      },
      candidate: {
        runId: candidateRun?.id ?? null,
        // Set once the job has completed and minted its STAGING version.
        versionId: job.resultVersionId,
        version: candidateVersion?.version ?? null,
        stage: candidateVersion?.stage ?? null,
        algorithm: candidateRun?.algorithm ?? null,
        metrics: candidateMetrics,
        // `metricsBasis` is null for a KEEP_EXISTING (or legacy null-
        // strategy) job: that path predates this feature's "every figure
        // names its basis" requirement, and is display-only history from
        // here on — never a target for D02's new labelling. MODEL-SERVE-021:
        // NEW_DATA_ONLY's main figure is scored on the shared validation
        // window (`newDataOnlyWindowBasis`), never `frozenTestBasis` — that
        // basis describes a frozen slice this strategy no longer carves.
        metricsBasis: isNewDataOnly ? newDataOnlyWindowBasis : frozenTestBasis,
        // MODEL-SERVE-015-T04. "Report new dataset evaluation separately" —
        // the candidate's OWN test-split score, over the COMBINED
        // (mixed-regime) data. Never used for `rmseDelta`; null for a plain
        // (014) retrain, where `metrics` above already carries this exact
        // number and a second copy would just invite the two to drift. Also
        // null for NEW_DATA_ONLY — there is no combined, mixed-regime data.
        newRegimeMetrics,
        newRegimeMetricsBasis: mergedTestBasis,
        // The operator's NEW-DATA validation window. Reported on its own
        // and deliberately NOT folded into `rmseDelta`: the incumbent was
        // never scored on these rows, so differencing the two would produce
        // a number that looks like a comparison and is not one.
        // MODEL-SERVE-021: null for NEW_DATA_ONLY — that exact figure is
        // already the headline `metrics`/`metricsBasis` above for this
        // strategy, and repeating it under a second name would just invite
        // the two to drift apart. The raw window facts below stay populated
        // either way; they describe the window, not a metric.
        newDataHoldoutMetrics:
          !isNewDataOnly && candidateRun?.newDataHoldoutMetrics
            ? metricTriple(candidateRun.newDataHoldoutMetrics)
            : null,
        newDataHoldoutRowCount: candidateRun?.newDataHoldoutRowCount ?? null,
        newDataHoldoutFrom:
          candidateRun?.newDataHoldoutFrom?.toISOString() ?? null,
        newDataHoldoutTo: candidateRun?.newDataHoldoutTo?.toISOString() ?? null,
        newDataHoldoutBasis: newDataWindowBasis,
      },
      // Negative = the candidate is better (lower RMSE). Null whenever the
      // bases differ — both raw numbers above are still present.
      rmseDelta,
      selectionMetric: 'rmse' as const,
    };
  }
}
