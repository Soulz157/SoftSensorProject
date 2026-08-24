import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@softsensor/prisma';
import {
  draftRunKey,
  modelRunKey,
  sidecarKey,
  VALIDATE_DATA_FILENAME,
} from '@/lib/artifact-keys';
import {
  presignArtifact,
  PresignedArtifact,
  presignModelRunUpload,
  replayHoldoutForRun,
} from '@/lib/python-preprocess-client';
import { RunCompleteDto } from './dto/model-run.authorized.dto';

type RunOwner = { scope: 'model'; id: string } | { scope: 'draft'; id: string };

@Injectable()
export class ModelRunAuthorizedService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * EXACTLY ONE of modelId / modelDraftId is set, enforced by a DB CHECK
   * constraint (MODEL-FLOW-002) — a run created from the wizard has
   * modelDraftId until Save Model adopts it (MODEL-FLOW-003-T08), after
   * which modelId is set and modelDraftId is KEPT for traceability. This
   * resolves which root (models/ or drafts/) the run's own outputs live
   * under, since a run adopted at Save Model still keeps writing to its
   * original prefix — Save Model never re-uploads bytes.
   */
  private resolveRunOwner(run: {
    id: string;
    modelId: string | null;
    modelDraftId: string | null;
  }): RunOwner {
    if (run.modelId) return { scope: 'model', id: run.modelId };
    if (run.modelDraftId) return { scope: 'draft', id: run.modelDraftId };
    // Unreachable given the CHECK constraint — guarded so a future schema
    // change cannot silently reintroduce a run with neither.
    throw new BadRequestException(
      `Run ${run.id} has neither modelId nor modelDraftId.`,
    );
  }

  /** Same key layout `complete()` writes run outputs to — `claim()` needs it
   * too, to place the replayed holdout under this run's own prefix. */
  private buildRunKey(
    owner: RunOwner,
    runId: string,
    filename: string,
  ): string {
    return owner.scope === 'draft'
      ? draftRunKey(owner.id, runId, filename)
      : modelRunKey(owner.id, runId, filename);
  }

  /**
   * DS-LAKE-018-T05. If this run's dataset has a raw validation holdout
   * (a BRONZE sibling of the run's own GOLD artifact with a recorded
   * `validationRowCount`), replay the GOLD's own recipe over it and presign
   * the result — this is what wires T04's replay endpoint into a real
   * training run, since nothing had called it before this task.
   *
   * Deliberately SOFT-FAIL: unlike the checksum-drift guard above, a
   * holdout replay problem must never fail a run that has nothing to do
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
  } | null> {
    if (!run.featureSpecKey) return null;

    const gold = await this.prisma.datasetArtifact.findUnique({
      where: { id: run.goldArtifactId },
      select: { runId: true },
    });
    if (!gold) return null;

    const bronze = await this.prisma.datasetArtifact.findFirst({
      where: { runId: gold.runId, type: 'BRONZE' },
      select: {
        objectKey: true,
        validationRowCount: true,
        validationHoldoutFrom: true,
      },
    });
    if (
      !bronze ||
      bronze.validationRowCount == null ||
      !bronze.validationHoldoutFrom
    ) {
      return null;
    }

    try {
      // Derived from `bronze.objectKey` (the key actually written), not
      // rebuilt from `run.datasetId` — a draft-built dataset's BRONZE lives
      // under `drafts/{draftId}/…`, so the old `validateDataKey(datasetId,
      // bronze.id)` produced a key nothing ever wrote and this replay
      // silently skipped (soft-fail below) for every such run.
      const sourceKey = sidecarKey(bronze.objectKey, VALIDATE_DATA_FILENAME);
      const targetKey = this.buildRunKey(
        owner,
        run.id,
        'validate_ready.parquet',
      );

      await replayHoldoutForRun({
        feature_spec_key: run.featureSpecKey,
        source_key: sourceKey,
        target_key: targetKey,
        holdout_from: bronze.validationHoldoutFrom.toISOString(),
        // Deterministic per-run key, nothing else ever reads or writes it —
        // unlike GOLD's data.parquet, a second claim() re-replaying is
        // harmless, not a leakage risk.
        overwrite: true,
      });
      const holdoutPresigned = await presignArtifact({ source_key: targetKey });

      return {
        holdoutDataUrl: holdoutPresigned.data_url,
        holdoutArtifactChecksum: holdoutPresigned.checksum,
        holdoutRowCount: holdoutPresigned.row_count,
      };
    } catch (err) {
      await this.appendLog(run.id, {
        level: 'warn',
        message: `Holdout replay skipped: ${(err as Error).message}`,
      });
      return null;
    }
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

    const owner = this.resolveRunOwner(run);
    const holdout = await this.tryReplayHoldout(run, owner);

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
    const owner = this.resolveRunOwner(run);
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
    const owner = this.resolveRunOwner(run);
    const keyIf = (f: string) =>
      uploaded.has(f) ? this.buildRunKey(owner, run.id, f) : null;

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
      finishedAt: new Date(),
      // Close the token with the run. Nothing legitimate needs it after
      // this point.
      tokenExpiresAt: new Date(0),
    };

    // A successful draft-scoped run flips its owning draft to TRAINED
    // (MODEL-FLOW-003-T07) in the same transaction as the run update — a
    // reader must never observe a SUCCEEDED run against a still-ACTIVE
    // draft.
    if (owner.scope === 'draft' && dto.status === 'SUCCEEDED') {
      const [updatedRun] = await this.prisma.$transaction([
        this.prisma.modelTrainingRun.update({
          where: { id: runId },
          data,
          omit: { tokenHash: true },
        }),
        this.prisma.modelDraft.update({
          where: { id: owner.id },
          data: { status: 'TRAINED', currentRunId: runId },
        }),
      ]);
      return updatedRun;
    }

    return this.prisma.modelTrainingRun.update({
      where: { id: runId },
      data,
      omit: { tokenHash: true },
    });
  }
}
