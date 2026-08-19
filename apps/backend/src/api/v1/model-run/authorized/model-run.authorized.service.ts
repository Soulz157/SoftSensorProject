import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@softsensor/prisma';
import { draftRunKey, modelRunKey } from '@/lib/artifact-keys';
import {
  presignArtifact,
  PresignedArtifact,
  presignModelRunUpload,
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
    const buildKey =
      owner.scope === 'draft'
        ? (f: string) => draftRunKey(owner.id, run.id, f)
        : (f: string) => modelRunKey(owner.id, run.id, f);
    const keyIf = (f: string) => (uploaded.has(f) ? buildKey(f) : null);

    const data = {
      status: dto.status,
      failureReason: dto.failureReason ?? null,
      metrics: dto.metrics ?? undefined,
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
