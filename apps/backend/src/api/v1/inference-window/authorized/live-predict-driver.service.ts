import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '@softsensor/prisma';
import { env } from '@/config/env.config';
import {
  materializeInferenceWindow,
  readArtifactRows,
} from '@/lib/python-preprocess-client';
import { predictRows } from '@/lib/serving-client';
import { formatDtHour } from '@/lib/inference-windows';
import { ModelServingAuthorizedService } from '@/api/v1/model-serving/authorized/model-serving.authorized.service';
import { InferenceWindowSchedulerService } from './inference-window-scheduler.service';

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * MODEL-SERVE-011-T07. One live score's outcome, in the caller's terms.
 *
 * DISCRIMINATED, not `number | null`: every failure here is a legitimate,
 * fail-soft state of a working system (a quiet source, a tag reporting Bad,
 * a model never promoted), and each one sends a reader somewhere different.
 * A bare null would collapse them into "nothing happened", which is exactly
 * what a button cannot say.
 *
 * `predicted` is the value the model returned; `at` is the timestamp of the
 * ROW it scored, never `Date.now()` — the reading is as old as the data.
 */
export type LiveScoreOutcome =
  | { ok: true; predicted: number; at: string }
  | { ok: false; reason: string };

/**
 * MODEL-SERVE-008-T02. The LIVE PREDICTION driver: scores the current moment
 * through the warm synchronous /predict on a short cadence, so the Monitoring
 * tab has a continuously predicted series between hourly scheduled windows.
 *
 * WHY THIS PLANE AND NOT THE SCHEDULED ONE
 * decisions.the_dense_series_comes_from_the_serving_plane. A scheduled point
 * spawns a container (3-5s cold start) against INFERENCE_MAX_CONCURRENCY = 1;
 * /predict is a warm process with a bytes-bounded model LRU and a 30s
 * descriptor cache, load-verified at 90/90 requests across a promote
 * (MODEL-SERVE-002-V02). This driver therefore NEVER writes an
 * InferenceWindow, never spawns a container and never touches the scheduler's
 * concurrency slot. The two planes stay separate (MODEL-SERVE-001-T10 item 6)
 * — a window's predictions.parquet and a /predict row remain different
 * artifacts with different provenance, and nothing pools them into one feed.
 *
 * WHY THE CADENCE HAS A FLOOR
 * Measured on this plant's own tags 2026-09-17: PI snapshot ages ran 1s to
 * 541s across 18 feature tags. Driving faster than the slowest tag refreshes
 * re-scores inputs that have not changed and manufactures precision the
 * historian does not have. `livePredictCadenceMinutes` defaults to 10 for
 * that reason, and that also holds the storage bill to ~144 PredictionLog
 * rows and ~144 serving-logs/ objects per model per day.
 *
 * WHY IT READS A PARQUET BACK INSTEAD OF USING A SNAPSHOT
 * The obvious cheaper input — /input-status' live per-tag snapshot — reports
 * DERIVED features' STATUS by rolling up their base tags, and never computes
 * their VALUES (lib/feature-sources.ts). A model whose spec carries formula
 * columns would get a feature vector missing exactly those columns. So the
 * feature pipeline has to run, which is what `materializeInferenceWindow`
 * already does; this reads its output back by object key.
 *
 * NO CATCH-UP, BY DESIGN
 * `livePredictLastRunAt` gates who is due, and a missed tick is simply a gap
 * in a live chart — never a backfill debt. A restart after an outage scores
 * the current moment once, rather than replaying a burst of stale calls into
 * a chart whose whole claim is "this is now".
 */
@Injectable()
export class LivePredictDriverService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(LivePredictDriverService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly descriptor: ModelServingAuthorizedService,
    private readonly scheduler: InferenceWindowSchedulerService,
  ) {}

  onModuleInit(): void {
    const intervalMs = env.LIVE_PREDICT_TICK_INTERVAL_MS;
    if (intervalMs <= 0) {
      this.logger.log(
        'Live prediction driver disabled (LIVE_PREDICT_TICK_INTERVAL_MS <= 0).',
      );
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.timer.unref();
    this.logger.log(`Live prediction driver waking every ${intervalMs}ms.`);
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One sweep: score every schedule whose own cadence says it is due. */
  async tick(): Promise<void> {
    if (this.sweeping) return; // one sweep in flight at a time
    this.sweeping = true;
    try {
      const now = Date.now();
      // `livePredictEnabled` ONLY — deliberately not `enabled`. The
      // scheduled plane being stopped must not stop the live chart, and
      // turning the live chart on must not start scoring windows.
      const schedules = await this.prisma.inferenceSchedule.findMany({
        where: { livePredictEnabled: true },
      });
      for (const schedule of schedules) {
        const dueAt = schedule.livePredictLastRunAt
          ? schedule.livePredictLastRunAt.getTime() +
            schedule.livePredictCadenceMinutes * 60_000
          : 0; // never run — due immediately
        if (dueAt > now) continue;
        await this.scoreOne(schedule.modelId).catch((err) => {
          // A live chart missing a point is not an incident, and this
          // driver has no failure row to write: it deliberately owns no
          // InferenceWindow. Logged and dropped, the same fail-soft shape
          // MODEL-SERVE-005-T01 gave the prediction-log ingest.
          this.logger.warn(
            `Live prediction failed for model ${schedule.modelId}: ${msg(err)}`,
          );
        });
      }
    } finally {
      this.sweeping = false;
    }
  }

  /**
   * Materialize a narrow window, read its newest row, score it.
   *
   * Marks `livePredictLastRunAt` on EVERY outcome, including the ones that
   * produce no point: a model whose source is down would otherwise be
   * retried on every tick, turning a broken connector into a hot loop
   * against it.
   *
   * MODEL-SERVE-011-T07. RETURNS ITS OUTCOME, and every non-point path stays
   * fail-soft exactly as it was — what changed is that each one now NAMES
   * itself. `tick()` above still ignores the value (a live chart missing a
   * point is not an incident), but `runNowService` puts it on screen: a
   * button that reports success and produces nothing, with the reason only
   * in a server log, is the defect MODEL-SERVE-001-T26 exists to refuse.
   *
   * The reasons are written for an operator reading a toast, not for a log
   * grep — they say what to go look at.
   */
  async scoreOne(modelId: string): Promise<LiveScoreOutcome> {
    const schedule = await this.prisma.inferenceSchedule.findUnique({
      where: { modelId },
    });
    if (!schedule) {
      return { ok: false, reason: 'This model has no inference schedule.' };
    }

    try {
      const version = await this.prisma.modelVersion.findFirst({
        where: { modelId, stage: 'PRODUCTION' },
        select: { id: true, featureSpecKey: true },
      });
      // No production version is a legitimate state, not an error: a model
      // can be saved and never promoted. Nothing to score against.
      if (!version?.featureSpecKey) {
        return {
          ok: false,
          reason: 'No PRODUCTION version to score against.',
        };
      }

      const descriptorResult =
        await this.descriptor.getDescriptorByVersionIdService(version.id);
      const featureColumns = descriptorResult.data.featureColumns;

      // The window ends at now - lagMinutes for the SAME reason the
      // scheduled plane does (MODEL-SERVE-006-T04): PI tags do not arrive
      // together, so a window ending at now() is structurally complete and
      // factually empty in places. Its span is one cadence — just wide
      // enough to contain a fresh row at this schedule's own interval.
      const end = new Date(Date.now() - schedule.lagMinutes * 60_000);
      const start = new Date(
        end.getTime() - schedule.livePredictCadenceMinutes * 60_000,
      );
      const fetchConfig = this.scheduler.asFetchConfig(schedule.fetchConfig);
      const source = await this.scheduler.resolveSource(
        schedule.sourceId,
        fetchConfig,
      );
      const { dt, hour } = formatDtHour(start);

      const materialized = await materializeInferenceWindow({
        feature_spec_key: version.featureSpecKey,
        feature_columns: featureColumns,
        model_id: modelId,
        model_version_id: version.id,
        dt,
        hour,
        window_start: start.toISOString(),
        window_end: end.toISOString(),
        interval: fetchConfig.intervalTime,
        ...source,
      });
      // A quiet source is not an incident — the same judgement T05/T01 made
      // when "too few usable rows" became SKIPPED rather than FAILED.
      if (materialized.scored_rows < 1 || !materialized.object_key) {
        return {
          ok: false,
          reason:
            'The source returned no usable rows for the last few minutes.',
        };
      }

      const page = await readArtifactRows({
        source_key: materialized.object_key,
        offset: 0,
        limit: materialized.scored_rows,
      });
      const newest = page.rows.at(-1);
      if (!newest) {
        return {
          ok: false,
          reason:
            'The source returned no usable rows for the last few minutes.',
        };
      }

      // A Bad cell is NOT a measurement, and its numeric value is not a
      // reading. This ledger has refused the fabricate-a-plausible-number
      // trade repeatedly (a Bad cell's 0.0 read as a measurement is one of
      // the named cases); scoring a row with a Bad required column would
      // publish a confident prediction over a value nobody measured.
      const unusable = featureColumns.filter(
        (c) => (newest.cells[c]?.status ?? 'Bad') !== 'Good',
      );
      if (unusable.length > 0) {
        this.logger.warn(
          `Live prediction skipped for model ${modelId}: ${unusable.length} feature column(s) not Good at ${newest.timestamp}.`,
        );
        // NAMED, not counted: which tag is bad is what a reader acts on.
        // Capped so one broken source cannot produce an unreadable toast.
        const named = unusable.slice(0, 3).join(', ');
        return {
          ok: false,
          reason: `Input not usable — ${named}${
            unusable.length > 3 ? ` +${unusable.length - 3} more` : ''
          } did not report Good values.`,
        };
      }

      const row: Record<string, number> = {};
      for (const column of featureColumns) {
        row[column] = newest.cells[column]!.value;
      }

      // Values go PRE-SCALE and unaltered: the materialized frame is in raw
      // engineering units by `inference_window_service`'s own contract, and
      // the serving process applies the fitted transform. Scaling here would
      // be a fourth opinion about what scaling means.
      const result = await predictRows({ modelId, rows: [row] });
      // Logged rather than discarded: a tag-mapping drift surfaces here
      // FIRST, as columns quietly going unused while predictions keep
      // returning plausible numbers.
      if (result.inputTagCheck.unusedColumns.length > 0) {
        this.logger.warn(
          `Live prediction for model ${modelId} sent ${result.inputTagCheck.unusedColumns.length} column(s) the model did not use.`,
        );
      }
      // PredictionLog is written by the SERVING process's own background
      // task (MODEL-SERVE-005-T01), sampled at SERVING_LOG_SAMPLE_RATE.
      // This driver deliberately writes no row itself — one writer, so the
      // sampling rate on a row always means what it says.
      //
      // MODEL-SERVE-011-T07. The returned value therefore comes from the
      // /predict RESPONSE, never from a read-back of the log: the log write
      // happens after that response, in the serving process's own
      // BackgroundTasks, and may be sampled out entirely. The number below
      // is what the model actually produced, which is true either way.
      const predicted = result.predictions[0];
      if (predicted === undefined) {
        return { ok: false, reason: 'The model returned no prediction.' };
      }
      return { ok: true, predicted, at: newest.timestamp };
    } finally {
      await this.prisma.inferenceSchedule.update({
        where: { modelId },
        data: { livePredictLastRunAt: new Date() },
      });
    }
  }
}
