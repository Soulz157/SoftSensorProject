import { Injectable } from '@nestjs/common';
import { PrismaService } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import { decryptSecret } from '@/lib/crypto';
import { buildPiCredentials } from '@/lib/source-block';
import { piResolveTags } from '@/lib/python-evaluation-client';
import {
  cleanTag,
  isNumericPointType,
  validateOutputTags,
} from '@/lib/write-back-config';
import { InferenceWindowSchedulerService } from '@/api/v1/inference-window/authorized/inference-window-scheduler.service';
import { ModelEvaluationAccessService } from './model-evaluation-access.service';
import type { PutWriteBackConfigDto } from './dto/model-evaluation.authorized.dto';

function unprocessable(message: string): AppException {
  return new AppException({ statusCode: 422, message, type: 'ERROR' });
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * MODEL-SERVE-032. A model's PI write-back destination: one output tag for
 * predictions, one for lab values.
 *
 * The destination data source is the model's OWN production source (its
 * inference schedule's `sourceId`), never a caller-supplied id. A write goes
 * where the model already reads, under the same stored account, so there is
 * nothing for a request body to redirect.
 *
 * Saving verifies each tag against PI (it exists and is a numeric point) and
 * refuses a config it cannot verify; PI being unreachable is a refusal, not
 * a silent save. It does NOT prove the account may write to the tag: PI
 * point security is only discoverable by writing, which the first write
 * reports honestly.
 */
@Injectable()
export class WriteBackConfigAuthorizedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ModelEvaluationAccessService,
    private readonly scheduler: InferenceWindowSchedulerService,
  ) {}

  async getConfigService(modelId: string, user: Auth.UserPayload) {
    const model = await this.access.assertRead(modelId, user);
    const [schedule, config, targetTag, canWrite] = await Promise.all([
      this.prisma.inferenceSchedule.findUnique({
        where: { modelId },
        select: { sourceId: true },
      }),
      this.prisma.modelWriteBackConfig.findUnique({ where: { modelId } }),
      this.targetTagOf(modelId),
      this.access.canWriteBackToModel(model.workspaceId, user),
    ]);
    // Show the source the WRITE would use: the saved config's, else the
    // schedule's. They differ only if the schedule was re-pointed after the
    // config was saved, which `sourceChanged` reports.
    const sourceId = config?.sourceId ?? schedule?.sourceId ?? null;
    const source = sourceId
      ? await this.prisma.dataSource.findUnique({
          where: { id: sourceId },
          select: { id: true, name: true, type: true, username: true },
        })
      : null;

    return {
      data: {
        config: config
          ? {
              sourceId: config.sourceId,
              predictionTag: config.predictionTag,
              labTag: config.labTag,
              updatedAt: config.updatedAt.toISOString(),
            }
          : null,
        canWrite,
        // `piAccount` is the login PI will attribute a write to, shown in
        // the confirm dialog. The username is not a secret; the password
        // never leaves the server.
        source: source
          ? {
              id: source.id,
              name: source.name,
              type: source.type,
              piAccount: source.username,
              writable: source.type === 'aveva',
            }
          : null,
        sourceChanged:
          !!config && !!schedule && config.sourceId !== schedule.sourceId,
        targetTag,
      },
    };
  }

  async putConfigService(
    modelId: string,
    dto: PutWriteBackConfigDto,
    user: Auth.UserPayload,
  ) {
    await this.access.assertWriteBack(modelId, user);

    const schedule = await this.prisma.inferenceSchedule.findUnique({
      where: { modelId },
      select: { sourceId: true, fetchConfig: true },
    });
    if (!schedule) {
      throw unprocessable(
        'This model has no production data source. Configure its inference schedule in Monitoring first.',
      );
    }
    const source = await this.prisma.dataSource.findUnique({
      where: { id: schedule.sourceId },
    });
    if (!source) {
      throw unprocessable("The model's data source no longer exists.");
    }
    if (source.type !== 'aveva') {
      throw unprocessable(
        `Write-back targets PI; this model's source "${source.name}" is ${source.type}.`,
      );
    }
    const targetTag = await this.targetTagOf(modelId);
    if (!targetTag) {
      throw unprocessable(
        'This model has no trained version to take a lab target from.',
      );
    }

    const predictionTag = cleanTag(dto.predictionTag);
    const labTag = cleanTag(dto.labTag);
    const fetchConfig = this.scheduler.asFetchConfig(schedule.fetchConfig);
    const inputTags = fetchConfig.tags ?? [];
    const rule = validateOutputTags({
      predictionTag,
      labTag,
      // PI names on both sides: under a live source override the target's
      // PI tag is its mapped one (MODEL-SERVE-037-T03).
      targetTag: fetchConfig.columnTagMap?.[targetTag] ?? targetTag,
      inputTags,
    });
    if (rule) throw unprocessable(rule);

    await this.verifyInPi(source, [predictionTag, labTag]);

    await this.prisma.modelWriteBackConfig.upsert({
      where: { modelId },
      create: {
        modelId,
        sourceId: schedule.sourceId,
        predictionTag,
        labTag,
        updatedById: user.id,
      },
      update: {
        sourceId: schedule.sourceId,
        predictionTag,
        labTag,
        updatedById: user.id,
      },
    });
    return this.getConfigService(modelId, user);
  }

  /** The tags must exist in PI as numeric points. Unverifiable = refused. */
  private async verifyInPi(
    source: {
      host: string;
      username: string;
      dbName: string;
      config: unknown;
      secretCiphertext: string;
    },
    tags: Array<string | null>,
  ): Promise<void> {
    const wanted = tags.filter((t): t is string => t !== null);
    if (wanted.length === 0) return;

    let result: Awaited<ReturnType<typeof piResolveTags>>;
    try {
      result = await piResolveTags({
        credentials: buildPiCredentials(
          source as Parameters<typeof buildPiCredentials>[0],
          decryptSecret(source.secretCiphertext),
        ),
        tag_list: wanted,
      });
    } catch (err) {
      throw unprocessable(
        `Could not verify the tags in PI, so nothing was saved: ${msg(err)}`,
      );
    }
    const byName = new Map(
      result.tags.map((t) => [t.tagName.toLowerCase(), t] as const),
    );
    for (const tag of wanted) {
      const found = byName.get(tag.toLowerCase());
      if (!found?.exists) {
        throw unprocessable(`Tag "${tag}" was not found in PI.`);
      }
      if (!isNumericPointType(found.pointType)) {
        throw unprocessable(
          `Tag "${tag}" is a ${found.pointType ?? 'non-numeric'} point; it must be a numeric (Float / Int) point to hold a value.`,
        );
      }
    }
  }

  /** The lab target: the PRODUCTION version's, else the newest version's. */
  async targetTagOf(modelId: string): Promise<string | null> {
    const select = { sourceRun: { select: { targetY: true } } } as const;
    const production = await this.prisma.modelVersion.findFirst({
      where: { modelId, stage: 'PRODUCTION' },
      select,
    });
    if (production) return production.sourceRun.targetY;
    const latest = await this.prisma.modelVersion.findFirst({
      where: { modelId },
      orderBy: { createdAt: 'desc' },
      select,
    });
    return latest?.sourceRun.targetY ?? null;
  }
}
