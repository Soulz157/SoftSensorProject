// model/authorized/model-run.service.ts
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { PrismaService } from '@softsensor/prisma';
import { CreateTrainingRunDto } from './dto/model-run.authorized.dto';
import { fetchArtifactMetadata } from '@/lib/python-preprocess-client';
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
      splitSpec: {
        method: 'chronological' as const,
        ratio: dto.trainTestSplit ?? 0.8,
        // cut_timestamp/train_rows/test_rows are filled by the container —
        // they cannot be known until non-Good target rows are dropped.
      },
    };
  }

  /** Mint a run token and its hash. The plaintext never touches a DB row. */
  private mintToken(): { token: string; tokenHash: string } {
    const token = randomBytes(32).toString('base64url');
    return {
      token,
      tokenHash: createHash('sha256').update(token).digest('hex'),
    };
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
    const draft = await this.assertDraftAccess(draftId, userId, role);
    if (draft.status === 'SAVED') {
      throw new BadRequestException(
        `Draft ${draftId} has already been saved as a Model — its runs are ` +
          `frozen. Start a new draft to train again.`,
      );
    }
    if (draft.status === 'ABANDONED') {
      throw new BadRequestException(`Draft ${draftId} has been abandoned.`);
    }

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
    if (run.status !== 'QUEUED' && run.status !== 'RUNNING') return run;

    if (run.containerId) await this.runner.kill(run.containerId);
    return this.prisma.modelTrainingRun.update({
      where: { id: runId },
      omit: { tokenHash: true },
      data: {
        status: 'CANCELED',
        finishedAt: new Date(),
        tokenExpiresAt: new Date(0),
      },
    });
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
    return this.prisma.modelTrainingRun.findMany({
      where: { modelDraftId: draftId },
      omit: { tokenHash: true },
      orderBy: { createdAt: 'desc' },
    });
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
    return run;
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
