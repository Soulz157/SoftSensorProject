import { Injectable } from '@nestjs/common';
import { PrismaService } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import { ModelServingAuthorizedService } from '@/api/v1/model-serving/authorized/model-serving.authorized.service';
import { InferenceWindowSchedulerService } from '@/api/v1/inference-window/authorized/inference-window-scheduler.service';
import {
  evaluationFrame,
  piRecorded,
  type PiRecordedResult,
} from '@/lib/python-evaluation-client';
import { predictRows } from '@/lib/serving-client';
import {
  assemblePoints,
  chunk,
  expectedRows,
  featureRow,
  labEvents,
  MAX_COMPARE_DAYS,
  MAX_COMPARE_ROWS,
  PREDICT_CHUNK,
  xSeries,
} from '@/lib/evaluation-compare';
import { ModelEvaluationAccessService } from './model-evaluation-access.service';
import type { CompareModelEvaluationDto } from './dto/model-evaluation.authorized.dto';

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function unprocessable(message: string): AppException {
  return new AppException({ statusCode: 422, message, type: 'ERROR' });
}

/**
 * MODEL-SERVE-032. The Evaluation page's compare read: import a range from
 * the model's data source, score it with the PRODUCTION version NOW, and hand
 * back predictions beside the raw recorded lab events and the X series.
 *
 * Synchronous and capped by design (CLAUDE.md: no long-blocking requests):
 * the range is limited in days AND in rows, both checked before any fetch.
 *
 * Nothing is persisted. It does not write an InferenceWindow, a
 * ManualPrediction or a PredictionLog row, and it never touches the
 * scheduler's concurrency slot -- it reuses the scheduler only for
 * `asFetchConfig` / `resolveSource`, which are public so the source mapping
 * has one copy.
 *
 * Pairing prediction to lab and the metrics are the CLIENT's pure functions:
 * the user edits lab values on the page and the numbers must follow live.
 */
@Injectable()
export class ModelEvaluationAuthorizedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ModelEvaluationAccessService,
    private readonly descriptor: ModelServingAuthorizedService,
    private readonly scheduler: InferenceWindowSchedulerService,
  ) {}

  async compareService(
    modelId: string,
    dto: CompareModelEvaluationDto,
    user: Auth.UserPayload,
  ) {
    await this.access.assertRead(modelId, user);

    const from = new Date(dto.from);
    const to = new Date(dto.to);
    if ((to.getTime() - from.getTime()) / 86_400_000 > MAX_COMPARE_DAYS) {
      throw unprocessable(
        `A compare range is limited to ${MAX_COMPARE_DAYS} days. Narrow the range.`,
      );
    }

    const schedule = await this.prisma.inferenceSchedule.findUnique({
      where: { modelId },
    });
    if (!schedule) {
      throw unprocessable(
        'This model has no production data source. Configure its inference schedule in Monitoring first.',
      );
    }
    const version = await this.prisma.modelVersion.findFirst({
      where: { modelId, stage: 'PRODUCTION' },
      select: { id: true, version: true, featureSpecKey: true },
    });
    if (!version?.featureSpecKey) {
      throw unprocessable(
        'This model has no PRODUCTION version to score with.',
      );
    }

    const fetchConfig = this.scheduler.asFetchConfig(schedule.fetchConfig);
    const rows = expectedRows(from, to, fetchConfig.intervalTime);
    if (rows === null) {
      throw unprocessable(
        `The schedule's fetch interval "${fetchConfig.intervalTime}" is not understood.`,
      );
    }
    if (rows > MAX_COMPARE_ROWS) {
      throw unprocessable(
        `This range is about ${rows} rows at a ${fetchConfig.intervalTime} interval; the limit is ${MAX_COMPARE_ROWS}. Narrow the range.`,
      );
    }

    const d = (
      await this.descriptor.getDescriptorByVersionIdService(version.id)
    ).data;
    const featureColumns = d.featureColumns;
    const targetTag = d.targetY;
    // The X panel shows the model's raw base tags, minus the lab target (which
    // is Y, charted on its own). Never scored.
    // Training names: under a live source override (MODEL-SERVE-037-T03)
    // `tags` are the PI names python renames away before building rows.
    const displayTags = (
      fetchConfig.columnTagMap
        ? Object.keys(fetchConfig.columnTagMap)
        : (fetchConfig.tags ?? [])
    ).filter((t) => t !== targetTag);

    let source: Awaited<
      ReturnType<InferenceWindowSchedulerService['resolveSource']>
    >;
    try {
      source = await this.scheduler.resolveSource(
        schedule.sourceId,
        fetchConfig,
      );
    } catch (err) {
      throw unprocessable(`Could not open the data source: ${msg(err)}`);
    }

    const frame = await evaluationFrame({
      feature_spec_key: version.featureSpecKey,
      feature_columns: featureColumns,
      display_tags: displayTags,
      window_start: from.toISOString(),
      window_end: to.toISOString(),
      interval: fetchConfig.intervalTime,
      max_rows: MAX_COMPARE_ROWS,
      ...source,
    });

    // Score ONLY usable rows. A row with any non-Good feature is never scored
    // and never imputed -- the rule `LivePredictDriverService.scoreOne` holds.
    const usable = frame.rows.filter((r) => r.usable);
    const predictions: number[] = [];
    for (const part of chunk(usable, PREDICT_CHUNK)) {
      const res = await predictRows({
        modelId,
        rows: part.map((r) => featureRow(r, featureColumns)),
      });
      predictions.push(...res.predictions);
    }
    const points = assemblePoints(frame.rows, featureColumns, predictions);

    const lab = await this.readLab(source, targetTag, from, to);

    return {
      data: {
        modelVersionId: version.id,
        version: version.version,
        targetTag,
        featureColumns,
        interval: fetchConfig.intervalTime,
        // The pairing window the client should use between a lab event and
        // the nearest prediction -- the schedule's own truth tolerance.
        toleranceMinutes: schedule.truthToleranceMinutes,
        range: { from: from.toISOString(), to: to.toISOString() },
        counts: {
          rows: frame.rows.length,
          scored: usable.length,
          skipped: frame.unusable_rows,
        },
        points,
        features: xSeries(frame.rows, displayTags),
        lab,
      },
    };
  }

  /**
   * Raw recorded lab events. PI only for now: a SQL source has no recorded
   * -event read, and substituting its interval rows would chart a held value
   * as if it were a fresh measurement. Fail-soft and EXPLICIT -- predictions
   * still come back, with the reason lab is absent.
   */
  private async readLab(
    source: { pi?: Record<string, unknown>; sql?: Record<string, unknown> },
    targetTag: string,
    from: Date,
    to: Date,
  ): Promise<{
    supported: boolean;
    events: Array<{ t: string; value: number }>;
    truncated: boolean;
    error: string | null;
  }> {
    const credentials = source.pi?.credentials as
      | Record<string, unknown>
      | undefined;
    if (!credentials) {
      return {
        supported: false,
        events: [],
        truncated: false,
        error:
          'Lab import reads recorded events from PI; this source is not PI.',
      };
    }
    let recorded: PiRecordedResult;
    try {
      recorded = await piRecorded({
        credentials,
        tag: targetTag,
        start_time: from.toISOString(),
        end_time: to.toISOString(),
      });
    } catch (err) {
      return {
        supported: true,
        events: [],
        truncated: false,
        error: `Could not read lab values for ${targetTag}: ${msg(err)}`,
      };
    }
    return {
      supported: true,
      events: labEvents(recorded.points, from, to),
      truncated: recorded.truncated,
      error: null,
    };
  }
}
