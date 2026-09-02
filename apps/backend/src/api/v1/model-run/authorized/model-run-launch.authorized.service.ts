// model/authorized/model-run.service.ts
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { mintRunToken } from '@/lib/mint-run-token';
import { findHoldoutArtifact } from '@/lib/holdout-artifact';
import { PrismaService } from '@softsensor/prisma';
import { CreateTrainingRunDto } from './dto/model-run.authorized.dto';
import {
  fetchArtifactMetadata,
  getRunCvFolds,
  runPredictions,
} from '@/lib/python-preprocess-client';
import { postToPython, PYTHON_TIMEOUT } from '@/lib/python-client';
import { PythonSplitStatsSchema } from '../../dataset-version/authorized/dto/dataset-version.authorized.dto';
import { AppException } from '@softsensor/common';
import { TrainningContainerAuthorizedService } from '../../trainning-container/authorized/trainning-container.authorized.service';

/** Anything longer than this and the token, not the run, is the risk. */
const RUN_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
/** A chronological split needs enough labelled rows on BOTH sides to mean
 *  anything. Enforced here so a doomed run never reaches a container. */
const MIN_LABELLED_ROWS = 30;

@Injectable()
export class ModelRunLaunchAuthorizedService {
  private readonly log = new Logger(ModelRunLaunchAuthorizedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: TrainningContainerAuthorizedService,
  ) {}

  private async assertHasAccess(
    workspaceId: string,
    userId: string,
    userRole: string,
  ) {
    if (userRole === 'ADMIN') return;

    const workspace = await this.prisma.workspace.findFirst({
      where: { id: workspaceId, ownerId: userId },
      select: { id: true },
    });
    if (workspace) return;
    const member = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId, userId },
    });
    if (!member)
      throw new AppException({
        statusCode: 403,
        message: 'Forbidden',
        type: 'ERROR',
      });
  }

  /**
   * Validates the submitted artifact/target/split against the FINAL
   * artifact it names and returns the run-row fields that do not depend on
   * ownership. Shared by both `createRunService` (Model-owned) and
   * `createDraftRunService` (ModelDraft-owned, MODEL-FLOW-003) so the two
   * cannot drift on what makes a run trainable — see this file's own
   * history (MODEL-FLOW-000-T01) for what happens when they do.
   *
   * Deliberately reads target/algorithm/hyperparameters/split FROM THE
   * REQUEST BODY, never off a ModelDraft row: `useModelDraftSync` PATCHes
   * the draft on a 600ms debounce and swallows failures silently, so the
   * draft can be stale at the instant Start Training is clicked. The body
   * is what the run row records and what makes the run reproducible.
   */
  private async buildRunData(dto: CreateTrainingRunDto) {
    const artifact = await this.prisma.datasetArtifact.findUnique({
      where: { id: dto.goldArtifactId },
    });
    if (!artifact) throw new NotFoundException('Artifact not found');
    if (artifact.type !== 'FINAL') {
      throw new BadRequestException(
        `Artifact ${artifact.id} is ${artifact.type}. Training reads the ` +
          `dataset's committed FINAL artifact — save the dataset first.`,
      );
    }
    if (!artifact.checksum) {
      // A backfilled row (DS-LAKE-002) carries an empty checksum. Without one
      // the container has nothing to verify against, and the run's
      // reproducibility claim would be a lie. checksum_of() can repair this.
      throw new BadRequestException(
        `Artifact ${artifact.id} has no recorded checksum — it predates ` +
          `checksum tracking. Re-verify it before training.`,
      );
    }
    // `datasetId` is nullable on the artifact but REQUIRED on the run row: a
    // run must be traceable back to a dataset, and a null here means the
    // artifact is a draft/orphan that nothing should be trained on yet.
    if (!artifact.datasetId) {
      throw new BadRequestException(
        `Artifact ${artifact.id} is not attached to a dataset — it cannot be ` +
          `trained on until its draft is saved.`,
      );
    }

    // Y must exist in the artifact as stored, not merely in the dataset's tag
    // list: select_columns and applyFeatures both change the column set, so
    // the dataset row's `tags` is not the artifact's schema.
    const meta = await fetchArtifactMetadata(artifact.objectKey);
    if (!meta.tags.includes(dto.targetY)) {
      throw new BadRequestException(
        `'${dto.targetY}' is not a column in this artifact. It has ` +
          `${meta.tags.length} tags — check the target survived column selection.`,
      );
    }
    if (meta.row_count < MIN_LABELLED_ROWS) {
      throw new BadRequestException(
        `Artifact has ${meta.row_count} rows; a chronological split needs at ` +
          `least ${MIN_LABELLED_ROWS}. Note this is the ROW count — rows whose ` +
          `target is not Good are dropped inside the run, so the labelled ` +
          `count can be far lower.`,
      );
    }

    // MODEL-FLOW-016-T03/T07. Two CONFIG-TIME refusals for a CV run, both
    // fired here rather than inside the container: this feature's own
    // requirement is to refuse "before k fits are paid for", and a
    // container that spawns only to die on its own backstop has already
    // cost the artifact download and the queue slot.
    if (dto.nSplits !== undefined) {
      // (a) T01(c): CV is TABULAR ONLY. lstm/gru cut on WINDOW count, not
      // labelled-row count (chronological_split_windows), a fold rule
      // this feature deliberately does not implement. train.py refuses
      // the same pair as a fit-time backstop.
      if (dto.algorithm === 'lstm' || dto.algorithm === 'gru') {
        throw new BadRequestException(
          `Cross-validation is not available for ${dto.algorithm}: sequence ` +
            `models split on window count, not labelled rows, which this ` +
            `feature does not implement. Use a chronological split instead.`,
        );
      }
      // (b) T07's own precondition (finding 6). A CV run produces NO
      // predictions.parquet by design — its only prediction series comes
      // from the separate, user-triggered holdout-scoring phase
      // (ModelRunScoreAuthorizedService). With no holdout on the dataset
      // that phase can never run, so the user would pay for k+1 fits and
      // receive fold metrics with no way to ever score the model that
      // actually ships. Refused at config time, with the reason named.
      const holdout = await findHoldoutArtifact(this.prisma, artifact.id);
      if (!holdout) {
        throw new BadRequestException(
          `This dataset has no validation holdout, so a cross-validation ` +
            `run could never be scored: CV reports fold metrics for the ` +
            `configuration and writes no predictions, and the saved model's ` +
            `own score comes from the holdout. Pick a holdout window when ` +
            `saving the dataset, or use a chronological split instead.`,
        );
      }
    }

    return {
      datasetId: artifact.datasetId,
      goldArtifactId: artifact.id,
      goldObjectKey: artifact.objectKey,
      artifactChecksum: artifact.checksum,
      featureSpecKey: artifact.featureSpecKey,
      targetY: dto.targetY,
      algorithm: dto.algorithm,
      hyperparameters: dto.hyperparameters ?? {},
      // Generated, not defaulted to a constant: a fixed seed across every
      // run hides variance, and an unrecorded one makes replay impossible.
      seed: dto.seed ?? randomInt(1, 2 ** 31 - 1),
      // MODEL-FLOW-016-T03. `n_splits` is the ONLY field known at creation
      // for a CV run — source_rows/labelled_rows/distinct_labelled_values
      // and the per-fold cuts are all filled by the container, for the
      // same reason cut_timestamp is below: they cannot be known until
      // non-Good target rows are dropped. NOT capped against
      // max_admissible_k here: that needs a full artifact read
      // (/split-stats), which the panel has already done at config time
      // and which train.py re-checks as a fit-time backstop — doing it a
      // third time would make Start Training wait on a second read of the
      // whole artifact.
      splitSpec:
        dto.nSplits !== undefined
          ? { method: 'cv_expanding' as const, n_splits: dto.nSplits }
          : {
              method: 'chronological' as const,
              ratio: dto.trainTestSplit ?? 0.8,
              // cut_timestamp/train_rows/test_rows are filled by the
              // container — they cannot be known until non-Good target
              // rows are dropped.
            },
    };
  }

  /** Mint a run token and its hash. The plaintext never touches a DB row.
   *  MODEL-FLOW-016-T07: extracted to `@/lib/mint-run-token` — the scoring
   *  trigger needs the identical mint a second time. */
  private mintToken(): { token: string; tokenHash: string } {
    return mintRunToken();
  }

  /**
   * Spawn out of band. A create request must not block for the length of an
   * image pull, and the run row is already durable — a spawn failure marks
   * it FAILED rather than losing it. Shared by both owner paths so a spawn
   * failure is handled identically regardless of what owns the run.
   */
  private trackSpawn(runId: string, token: string): void {
    void this.runner.spawn(runId, token).catch(async (err) => {
      const reason = err instanceof Error ? err.message : String(err);
      this.log.error(`spawn failed for run ${runId}`, err);
      await this.prisma.modelTrainingRun.update({
        where: { id: runId },
        data: {
          status: 'FAILED',
          failureReason: `Could not start container: ${reason}`.slice(0, 2000),
          finishedAt: new Date(),
          tokenExpiresAt: new Date(0),
        },
      });
    });
  }

  /**
   * MODEL-FLOW-014-T06. Freezes the Split Distribution panel's own record
   * of what the user was looking at when they pressed Start Training —
   * fire-and-forget, mirroring `trackSpawn`'s own shape, called AFTER the
   * run row exists (never inside `buildRunData`, which sits in the Start
   * Training request path: `/split-stats` runs at `PYTHON_TIMEOUT.metadata`
   * = 300,000ms, and a second full-artifact read there would make pressing
   * Start Training wait on it).
   *
   * Calls `postToPython` DIRECTLY, not `getArtifactSplitStatsService` —
   * that method opens with `assertDatasetAccess(datasetId, user)`, and this
   * helper has no `user`: authorization already happened when the run was
   * created (`assertDraftWritable`/`assertDraftAccess` above), and
   * re-checking it here would be re-authorizing a decision already made
   * against a background call that has nothing to check it with.
   *
   * `splitRatio`/`sampleRows`/`outlierCap` are pinned to what
   * `getArtifactSplitStatsService` sends when the client omits them
   * (server defaults) — the panel's own default request never sends
   * `sampleRows`/`outlierCap` either, so the two stay in sync by
   * construction, not by copying a second set of constants.
   *
   * A failure logs and leaves `splitStats` null — structurally incapable of
   * failing the run itself, since this fires after the row is already
   * durable and the transaction that created it has already committed.
   */
  private freezeSplitStats(
    runId: string,
    objectKey: string,
    targetY: string,
    // MODEL-FLOW-016-T07. The run's OWN splitSpec, not a bare ratio: this
    // endpoint takes EXACTLY ONE of split_ratio / n_splits (its own
    // `_exactly_one_of_ratio_or_splits` validator, schemas/preprocess.py),
    // and a CV run sending split_ratio would freeze a plausible-looking
    // ratio-mode cut for a run that never used one — the "looks like
    // success" failure class this feature's ledger keeps naming, and the
    // exact precondition finding 12 recorded against this function.
    splitSpec:
      | { method: 'chronological'; ratio: number }
      | {
          method: 'cv_expanding';
          n_splits: number;
        },
    tags: string[],
  ): void {
    void postToPython(
      '/v1/preprocess/split-stats',
      {
        source_key: objectKey,
        tags,
        target_y: targetY,
        ...(splitSpec.method === 'cv_expanding'
          ? { n_splits: splitSpec.n_splits }
          : { split_ratio: splitSpec.ratio }),
      },
      PYTHON_TIMEOUT.metadata,
    )
      .then(async (raw) => {
        // Same convention `getArtifactSplitStatsService` uses — parsed, not
        // cast, so a connector shape change is a loud failure here too,
        // not a silently wrong sidecar.
        const splitStats = PythonSplitStatsSchema.parse(raw);
        await this.prisma.modelTrainingRun.update({
          where: { id: runId },
          data: { splitStats },
        });
      })
      .catch((err) => {
        // Never fails the run — this fires well after the run row and the
        // spawned container are both already real. A run whose split
        // distribution was never recorded reads as "not recorded for this
        // run" (the honest-legacy-null pattern), same as any legacy row.
        const reason = err instanceof Error ? err.message : String(err);
        this.log.warn(`freezeSplitStats failed for run ${runId}: ${reason}`);
      });
  }

  // NOTE: this method and its three siblings below (cancelRunService,
  // listRunsService, getRunService — the Model-scoped twins of the
  // draft-scoped methods further down) still return the raw Prisma row, not
  // the {statusCode, message, type, data} envelope. Left as-is because
  // nothing in apps/client calls authorized/model/.../runs today (confirmed
  // by grep) — but the draft-scoped versions had this EXACT bug in
  // production (client `.data.id` on an unwrapped response, throwing
  // "Cannot read properties of undefined"), so wrap these the same way
  // before wiring any real caller to this path.
  async createRunService(
    modelId: string,
    dto: CreateTrainingRunDto,
    userId: string,
    role: string,
  ) {
    await this.assertModelAccess(modelId, userId, role);
    const runData = await this.buildRunData(dto);
    const { token, tokenHash } = this.mintToken();

    const run = await this.prisma.modelTrainingRun.create({
      data: {
        ...runData,
        modelId,
        imageDigest: this.runner.imageDigest,
        tokenHash,
        tokenExpiresAt: new Date(Date.now() + RUN_TOKEN_TTL_MS),
        status: 'QUEUED',
      },
      omit: { tokenHash: true },
    });

    this.trackSpawn(run.id, token);
    return run;
  }

  /** Draft lifecycle gate shared by every write path below — a draft that is
   *  SAVED or ABANDONED must refuse a new run, whether that run is the
   *  user's own POST (`createDraftRunService`) or one launched by the
   *  candidate-job chain (`launchDraftRun`, MODEL-FLOW-005), well after the
   *  user's own request has finished. */
  private assertDraftWritableStatus(draftId: string, status: string): void {
    if (status === 'SAVED') {
      throw new BadRequestException(
        `Draft ${draftId} has already been saved as a Model — its runs are ` +
          `frozen. Start a new draft to train again.`,
      );
    }
    if (status === 'ABANDONED') {
      throw new BadRequestException(`Draft ${draftId} has been abandoned.`);
    }
  }

  /**
   * PUBLIC: the access+lifecycle gate `ModelCandidateJobAuthorizedService.
   * createJob` (MODEL-FLOW-005, generalized by MODEL-FLOW-013) needs before
   * creating a job's first run —
   * the same check `createDraftRunService` runs for a single run, exposed
   * once rather than reimplemented. `assertDraftAccess` stays private
   * (still only meaningful within a request that HAS a user/role to check);
   * this is the one door into it from outside this class.
   */
  async assertDraftWritable(draftId: string, userId: string, role: string) {
    const draft = await this.assertDraftAccess(draftId, userId, role);
    this.assertDraftWritableStatus(draftId, draft.status);
    return draft;
  }

  /** PUBLIC read-only counterpart to `assertDraftWritable` — access only, no
   *  lifecycle refusal. A SAVED or ABANDONED draft's candidate-job history is
   *  still legitimately readable; only NEW writes are refused for those. */
  async assertDraftReadable(draftId: string, userId: string, role: string) {
    return this.assertDraftAccess(draftId, userId, role);
  }

  /**
   * Same run-creation path as `createRunService`, keyed by a ModelDraft
   * instead of a Model (MODEL-FLOW-003) — the whole point of the refactor:
   * training must be able to run before a persistent Model exists.
   * Creates NO Model row and never reads or writes one.
   */
  async createDraftRunService(
    draftId: string,
    dto: CreateTrainingRunDto,
    userId: string,
    role: string,
  ) {
    await this.assertDraftWritable(draftId, userId, role);
    const run = await this.launchDraftRun(draftId, dto);
    // Envelope matches ModelDraftAuthorizedService's — same
    // authorized/model-drafts prefix, same client (services/model-draft.ts's
    // modelDraftRunService) unwraps `.data` on every call, same as it
    // already does for the draft CRUD methods next to this one. Returning
    // the raw row here (as this used to) makes `created.data.id` throw
    // "Cannot read properties of undefined (reading 'id')" client-side even
    // though the container spawned fine — the DB row and the container are
    // real, only the HTTP response shape was wrong.
    return {
      statusCode: 201,
      message: 'Training run created',
      type: 'SUCCESS' as const,
      data: run,
    };
  }

  /**
   * The actual run-creation write, with NO user/role parameter — the raw
   * row, not the envelope. Split out of `createDraftRunService` for
   * MODEL-FLOW-005: a candidate job's SECOND and later runs are launched
   * by the run-COMPLETION webhook (container -> backend via RunTokenGuard),
   * a request with no user session in it at all. Authorization for the
   * whole search happens ONCE, when the job itself is created
   * (`assertDraftWritable` above) — re-checking it on every chained run
   * would be re-authorizing a decision the user already made, against a
   * request that has nothing to check it with.
   *
   * The lifecycle guard is re-checked here regardless: a user can abandon a
   * draft mid-search, and the chain must not keep spawning containers
   * against one that no longer wants them.
   */
  async launchDraftRun(
    draftId: string,
    dto: CreateTrainingRunDto,
    candidateJobId?: string,
  ) {
    const draft = await this.prisma.modelDraft.findUnique({
      where: { id: draftId },
      select: { status: true },
    });
    if (!draft) throw new NotFoundException('Model draft not found');
    this.assertDraftWritableStatus(draftId, draft.status);

    const runData = await this.buildRunData(dto);
    const { token, tokenHash } = this.mintToken();

    // Interactive transaction, not the array form: the draft update needs
    // the run's generated id, so the two writes cannot be independent
    // statements — but they must still land atomically, or a reader could
    // observe a run with no draft pointing at it yet as "current".
    const run = await this.prisma.$transaction(async (tx) => {
      const created = await tx.modelTrainingRun.create({
        data: {
          ...runData,
          modelDraftId: draftId,
          candidateJobId: candidateJobId ?? null,
          imageDigest: this.runner.imageDigest,
          tokenHash,
          tokenExpiresAt: new Date(Date.now() + RUN_TOKEN_TTL_MS),
          status: 'QUEUED',
        },
        omit: { tokenHash: true },
      });
      await tx.modelDraft.update({
        where: { id: draftId },
        data: { currentRunId: created.id },
      });
      return created;
    });

    this.trackSpawn(run.id, token);

    // MODEL-FLOW-014-T06. Single-run launches only — a candidate run shares
    // its split with every other candidate in the same job, so freezing per
    // candidate would be N redundant artifact reads for one identical
    // answer; a candidate's provenance belongs to its job, not this column.
    if (!candidateJobId) {
      this.freezeSplitStats(
        run.id,
        runData.goldObjectKey,
        runData.targetY,
        runData.splitSpec,
        dto.splitStatsTags ?? [dto.targetY],
      );
    }

    return run;
  }

  async cancelRunService(
    modelId: string,
    runId: string,
    userId: string,
    role: string,
  ) {
    await this.assertModelAccess(modelId, userId, role);
    const run = await this.prisma.modelTrainingRun.findFirst({
      where: { id: runId, modelId },
      omit: { tokenHash: true },
    });
    if (!run) throw new NotFoundException();
    if (run.status !== 'QUEUED' && run.status !== 'RUNNING') return run;

    if (run.containerId) await this.runner.kill(run.containerId);
    const canceled = await this.prisma.modelTrainingRun.update({
      where: { id: runId },
      // Token invalidated in the same write: a killed container that survives
      // long enough to POST /complete must not be able to.
      omit: { tokenHash: true },

      data: {
        status: 'CANCELED',
        finishedAt: new Date(),
        tokenExpiresAt: new Date(0),
      },
    });
    return canceled;
  }

  async cancelDraftRunService(
    draftId: string,
    runId: string,
    userId: string,
    role: string,
  ) {
    await this.assertDraftAccess(draftId, userId, role);
    const run = await this.prisma.modelTrainingRun.findFirst({
      where: { id: runId, modelDraftId: draftId },
      omit: { tokenHash: true },
    });
    if (!run) throw new NotFoundException();
    // Same envelope as the rest of this draft-run resource — see
    // createDraftRunService's comment for why. Two return points here
    // (already-terminal vs. actually canceled) both need it.
    if (run.status !== 'QUEUED' && run.status !== 'RUNNING') {
      return {
        statusCode: 200,
        message: `Run already ${run.status.toLowerCase()}`,
        type: 'SUCCESS' as const,
        data: run,
      };
    }

    if (run.containerId) await this.runner.kill(run.containerId);
    const canceled = await this.prisma.modelTrainingRun.update({
      where: { id: runId },
      omit: { tokenHash: true },
      data: {
        status: 'CANCELED',
        finishedAt: new Date(),
        tokenExpiresAt: new Date(0),
      },
    });
    return {
      statusCode: 200,
      message: 'Training run canceled',
      type: 'SUCCESS' as const,
      data: canceled,
    };
  }

  async listRunsService(modelId: string, userId: string, role: string) {
    await this.assertModelAccess(modelId, userId, role);
    const runs = await this.prisma.modelTrainingRun.findMany({
      where: { modelId },
      omit: { tokenHash: true },

      orderBy: { createdAt: 'desc' },
    });
    return runs;
  }

  async listDraftRunsService(draftId: string, userId: string, role: string) {
    await this.assertDraftAccess(draftId, userId, role);
    const runs = await this.prisma.modelTrainingRun.findMany({
      where: { modelDraftId: draftId },
      omit: { tokenHash: true },
      orderBy: { createdAt: 'desc' },
    });
    // Same envelope as the rest of this draft-run resource — see
    // createDraftRunService's comment for why.
    return {
      statusCode: 200,
      message: 'Training runs fetched',
      type: 'SUCCESS' as const,
      data: runs,
    };
  }

  async getRunService(
    modelId: string,
    runId: string,
    userId: string,
    role: string,
  ) {
    await this.assertModelAccess(modelId, userId, role);
    const run = await this.prisma.modelTrainingRun.findFirst({
      where: { id: runId, modelId },
      omit: { tokenHash: true },
      include: { logs: { orderBy: { createdAt: 'asc' }, take: 500 } },
    });
    if (!run) throw new NotFoundException();
    return run;
  }

  /**
   * Draft-scoped twin of `getRunService` — required for Step 2/3 polling
   * (MODEL-FLOW-003-T09): a wizard run has `modelId: null` until Save Model
   * adopts it, so the model-keyed lookup above always 404s for it.
   */
  async getDraftRunService(
    draftId: string,
    runId: string,
    userId: string,
    role: string,
  ) {
    await this.assertDraftAccess(draftId, userId, role);
    const run = await this.prisma.modelTrainingRun.findFirst({
      where: { id: runId, modelDraftId: draftId },
      omit: { tokenHash: true },
      include: { logs: { orderBy: { createdAt: 'asc' }, take: 500 } },
    });
    if (!run) throw new NotFoundException();

    // MODEL-FLOW-016-T11. `cvFoldsKey` is only a pointer — Step 4/5's own
    // per-fold table needs the actual records. Read here, once, attached
    // to the same response the 2.5s poll loop already fetches, rather than
    // a second client-facing endpoint/hook (the `lossHistory` precedent in
    // `advanceJobForRun` reads the same way, attached, never its own
    // route). A read failure is soft — log and fall back to null, never
    // fail the whole run fetch over one auxiliary table this endpoint's
    // callers do not all need every tick.
    let cvFolds: Awaited<ReturnType<typeof getRunCvFolds>> | null = null;
    if (run.cvFoldsKey) {
      try {
        cvFolds = await getRunCvFolds(run.cvFoldsKey);
      } catch (err) {
        this.log.error(
          `getDraftRunService: could not read cv_folds for run ${runId}`,
          err,
        );
      }
    }

    // Same envelope fix as createDraftRunService, and arguably the more
    // load-bearing half of it: this is what the 2.5s poll loop
    // (use-model-training.ts pollRun) calls on every tick, so an unwrapped
    // response here breaks the SAME way even for a run that WAS created
    // successfully by a caller that doesn't hit the create-time crash.
    return {
      statusCode: 200,
      message: 'Training run fetched',
      type: 'SUCCESS' as const,
      data: { ...run, cvFolds },
    };
  }

  /**
   * MODEL-FLOW-004. Actual/predicted series for one draft-scoped run's test
   * split, for Step 4 Evaluation. `predictionsKey`/`manifestKey` are read
   * off the run row, never accepted from the request — the same discipline
   * `mintUploadUrls` applies on the write side. Refuses (404) a run that
   * has not SUCCEEDED or has no `predictionsKey`, naming which: a run still
   * training or one that FAILED has nothing to show, and the caller needs
   * to know which case it is to render the right empty state.
   */
  async getDraftRunPredictionsService(
    draftId: string,
    runId: string,
    userId: string,
    role: string,
  ) {
    await this.assertDraftAccess(draftId, userId, role);
    const run = await this.prisma.modelTrainingRun.findFirst({
      where: { id: runId, modelDraftId: draftId },
      select: { status: true, predictionsKey: true, manifestKey: true },
    });
    if (!run) throw new NotFoundException('Training run not found');
    if (run.status !== 'SUCCEEDED') {
      throw new AppException({
        statusCode: 404,
        message: `Training run has not succeeded (status: ${run.status}); no predictions to show.`,
        type: 'ERROR',
      });
    }
    if (!run.predictionsKey) {
      throw new AppException({
        statusCode: 404,
        message: 'Training run succeeded but recorded no predictions artifact.',
        type: 'ERROR',
      });
    }

    const predictions = await runPredictions({
      source_key: run.predictionsKey,
      manifest_key: run.manifestKey,
    });

    return {
      statusCode: 200,
      message: 'Training run predictions fetched',
      type: 'SUCCESS' as const,
      data: predictions,
    };
  }

  private async assertModelAccess(
    modelId: string,
    userId: string,
    role: string,
  ) {
    // Existence + workspace membership. Duplicates the rule
    // `ModelAuthorizedService` applies for CRUD rather than delegating to it
    // — a direct call would create a ModelModule <-> ModelRunModule cycle.
    // Extracting a shared ModelAccessService is the fix, not forwardRef.
    const model = await this.prisma.model.findUnique({
      where: { id: modelId },
      select: { id: true, workspaceId: true },
    });
    if (!model) throw new NotFoundException('Model not found');
    await this.assertHasAccess(model.workspaceId, userId, role);
    return model;
  }

  /**
   * Draft twin of `assertModelAccess`, same duplication rationale: importing
   * `ModelDraftAuthorizedService` here would pull `ModelDraftModule` into
   * `ModelRunModule`, and this file's whole reason to hold run-creation
   * logic is that `ModelDraftAuthorizedService` cannot resolve an
   * artifact/training concern without the reverse import existing too.
   */
  private async assertDraftAccess(
    draftId: string,
    userId: string,
    role: string,
  ) {
    const draft = await this.prisma.modelDraft.findUnique({
      where: { id: draftId },
      select: { id: true, workspaceId: true, status: true },
    });
    if (!draft) throw new NotFoundException('Model draft not found');
    await this.assertHasAccess(draft.workspaceId, userId, role);
    return draft;
  }
}
