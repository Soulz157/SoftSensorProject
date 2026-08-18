import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@softsensor/prisma';
import { modelRunKey } from '@/lib/artifact-keys';
import {
  presignArtifact,
  PresignedArtifact,
  presignModelRunUpload,
} from '@/lib/python-preprocess-client';
import { RunCompleteDto } from './dto/model-run.authorized.dto';

@Injectable()
export class ModelRunAuthorizedService {
  constructor(private readonly prisma: PrismaService) {}

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
    return presignModelRunUpload({
      model_id: run.modelId,
      run_id: run.id,
      filenames,
    });
  }

  async complete(runId: string, dto: RunCompleteDto) {
    const run = await this.prisma.modelTrainingRun.findUnique({
      where: { id: runId },
    });
    if (!run) throw new NotFoundException();

    const uploaded = new Set(dto.uploaded ?? []);
    const keyIf = (f: string) =>
      uploaded.has(f) ? modelRunKey(run.modelId, run.id, f) : null;

    return this.prisma.modelTrainingRun.update({
      where: { id: runId },
      data: {
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
      },
      omit: { tokenHash: true },
    });
  }
}
