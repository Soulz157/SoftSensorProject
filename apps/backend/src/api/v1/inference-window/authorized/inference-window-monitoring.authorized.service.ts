import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import type { FeatureStatsMap } from '@/lib/feature-stats';
import {
  computeRangeDrift,
  driftThresholds,
  gradeSeries,
  poolHistograms,
  type FeatureHistogram,
  type FeatureHistogramMap,
} from '@/lib/input-range-drift';
import { inferenceWindowInputSeries } from '@/lib/python-preprocess-client';
import {
  resolveColumnBaseline,
  resolveDriftReference,
} from '@/lib/artifact-baseline';
import { flatMinutes } from '@/lib/tag-observation';
import {
  classifyModelHealth,
  type HealthStatus,
  type HealthReason,
} from '@/lib/model-health';
// MODEL-SERVE-001-T26. T11's staleness formula, called rather than copied —
// it moved axes, it did not fork.
import { isStale } from '@/lib/deploy-status';
// MODEL-SERVE-001-T29. The frozen-tag detector, pure and co-located with its
// own spec like the other 13 modules in lib/.
import { detectFrozenColumns } from '@/lib/sensor-frozen';
import { computeTargetDrift } from '@/lib/target-monitoring';
import {
  classifyResidualSd,
  truthPoolSince,
  type ResidualSdVerdict,
} from '@/lib/residual-sd-health';
import { baselineResidualSd } from '@/lib/model-version-residual-sd';
import { summarizeDrift, type DriftSummary } from '@/lib/notification-digest';

/**
 * `resolveProductionWindows`'s own `take`. Named because T29's
 * `frozenWindows` is clamped against it: a setting larger than the sample
 * could never fire, which is precisely the "settings that appear to work and
 * may do nothing" defect T21's audit found and T28 exists to prevent.
 */
const PRODUCTION_WINDOW_TAKE = 24;

/** MODEL-SERVE-036. The Input Drift range read: at most 31 days of hourly
 *  windows' input files, and at most this many trend points per tag. */
export const DRIFT_RANGE_MAX_DAYS = 31;
const DRIFT_RANGE_MAX_WINDOWS = DRIFT_RANGE_MAX_DAYS * 24;
const DRIFT_TREND_MAX_POINTS = 600;

/**
 * MODEL-SERVE-001-T17. PSI, computed from `InferenceWindow`'s own
 * `featureHistograms` — the WINDOW plane, for a model with a scheduled
 * `InferenceSchedule`. The `/predict`-only counterpart lives in
 * `PredictionLogAuthorizedService.getInputDriftService`, which
 * calls `hasSchedule` below to decide which plane a model reads from — see
 * that service's own doc comment for the full dispatch rule. Both planes
 * run the SAME pure comparison function (`computeRangeDrift` from
 * `lib/input-range-drift.ts`) and the SAME artifact reference reads
 * (`lib/artifact-baseline.ts`) — only WHERE the live side of the
 * comparison is read from differs. (MODEL-SERVE-028 removed the z-score
 * drift report that used to sit beside it.)
 *
 * No `user`/access-check methods here: the caller (`PredictionLogAuthorized
 * Service`) already ran `assertModelAccess` once before dispatching:
 * duplicating that check here would be a second, redundant authorization
 * point for the same request rather than the one this codebase's other
 * background/internal helpers already establish (see `lib/artifact-
 * baseline.ts`'s own doc comment for the identical reasoning).
 */
@Injectable()
export class InferenceWindowMonitoringService {
  private readonly log = new Logger(InferenceWindowMonitoringService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The ENTIRE plane-selection rule, decided with the user 2026-09-15:
   * a model with an `InferenceSchedule` ROW — regardless of `enabled` —
   * reads the window plane; one without reads `PredictionLog`. Keyed on
   * CONFIGURATION, never on which table happens to hold rows: a model
   * toggled off after running on a schedule keeps reading its own real
   * accumulated window history rather than flipping to a `PredictionLog`
   * plane that is empty for the identical reason (a scheduled-only model
   * never logs there either) — the mode-switch-without-saying-so shape
   * this codebase's own `basis.plane`/`pipelineVersion` precedents keep
   * rejecting.
   */
  async hasSchedule(modelId: string): Promise<boolean> {
    const schedule = await this.prisma.inferenceSchedule.findUnique({
      where: { modelId },
      select: { id: true },
    });
    return schedule !== null;
  }

  /**
   * The PRODUCTION version (same 404 contract `PredictionLogAuthorizedServ
   * ice`'s own two methods already use — "no PRODUCTION version, nothing
   * to compare against") plus its most recent windows in `[from, to]`.
   *
   * ROLLING 24, NOT A SAMPLE-COUNT CAP CHOSEN FOR COST: per-window
   * sufficient statistics pool ADDITIVELY (the same trick `poolHistograms`
   * and `InferenceWindowTruth` already use elsewhere in this system), so a
   * rolling figure over the most recent 24 windows is EXACT, never an
   * average of averages — T17's own resolved cadence decision.
   *
   * NEVER FILTERED BY `status` AT THE QUERY LEVEL. A window feeds this pool
   * exactly when it carries a stored histogram/stats row, which happens
   * exactly when a real cleaned input frame was written — `put_frame` runs
   * before SKIPPED or FAILED is ever decided, so both still hold real,
   * cleaned input evidence.
   *
   * `from`/`to` OPTIONAL — MODEL-SERVE-001-T21's own addition.
   * `getHealthStatus` passes neither (it answers "what is the CURRENT health
   * reading") and gets the rolling most-recent-24 with no date floor. The
   * Input Drift card's range read (`getInputDriftReport`) has its own query
   * since MODEL-SERVE-036: it reads input files, not these histograms.
   */
  private async resolveProductionWindows(
    modelId: string,
    from?: string,
    to?: string,
  ) {
    const production = await this.prisma.modelVersion.findFirst({
      where: { modelId, stage: 'PRODUCTION' },
      // MODEL-SERVE-018. The target tag's name, for the display-only target
      // row in the drift/PSI reports.
      include: { sourceRun: { select: { targetY: true } } },
    });
    if (!production) {
      throw new AppException({
        statusCode: 404,
        message: `Model ${modelId} has no PRODUCTION version. Nothing to compare live traffic against.`,
        type: 'ERROR',
      });
    }

    const windows = await this.prisma.inferenceWindow.findMany({
      where: {
        modelVersionId: production.id,
        ...(from || to
          ? {
              windowStart: {
                ...(from && { gte: new Date(from) }),
                ...(to && { lte: new Date(to) }),
              },
            }
          : {}),
      },
      orderBy: { windowStart: 'desc' },
      take: PRODUCTION_WINDOW_TAKE,
      select: {
        windowStart: true,
        status: true,
        inputRows: true,
        // MODEL-SERVE-001-T27. T05's own Bad-CELL share, for the BAD_DATA
        // band. Absent from this select until now, so the band would have
        // had no input at all.
        missingPct: true,
        featureHistograms: true,
        featureStats: true,
        targetStats: true,
        targetHistogram: true,
      },
    });

    return { production, windows };
  }

  /**
   * MODEL-SERVE-036. Input drift by training range over `[from, to]`, read
   * from each SUCCEEDED window's input Parquet: per tag, the trend, the
   * per-window stats and the below/above counts that grade its badge — one
   * population for all four. Capped to the newest `DRIFT_RANGE_MAX_WINDOWS`
   * windows (31 days hourly); `basis.capped` says so.
   *
   * The target (y) is not in the input frame (it is narrowed away before the
   * frame is written), so its display-only row still grades from the
   * windows' own target histograms and carries no trend.
   */
  async getInputDriftReport(modelId: string, from: string, to: string) {
    const production = await this.prisma.modelVersion.findFirst({
      where: { modelId, stage: 'PRODUCTION' },
      include: { sourceRun: { select: { targetY: true } } },
    });
    if (!production) {
      throw new AppException({
        statusCode: 404,
        message: `Model ${modelId} has no PRODUCTION version. Nothing to compare live inputs against.`,
        type: 'ERROR',
      });
    }

    const rows = await this.prisma.inferenceWindow.findMany({
      where: {
        modelVersionId: production.id,
        status: 'SUCCEEDED',
        inputKey: { not: null },
        windowStart: { gte: new Date(from), lte: new Date(to) },
      },
      orderBy: { windowStart: 'desc' },
      take: DRIFT_RANGE_MAX_WINDOWS + 1,
      select: {
        windowStart: true,
        windowEnd: true,
        inputKey: true,
        targetHistogram: true,
      },
    });
    const capped = rows.length > DRIFT_RANGE_MAX_WINDOWS;
    const windows = rows.slice(0, DRIFT_RANGE_MAX_WINDOWS);

    const reference = await resolveDriftReference(production.goldObjectKey);
    const thresholds = driftThresholds();
    const targetColumn = production.sourceRun.targetY || null;

    let graded: ReturnType<typeof gradeSeries> = {
      report: { status: 'UNKNOWN', columns: [] },
      series: {},
    };
    let missing = 0;
    if (windows.length > 0) {
      const references: Record<
        string,
        { edges: number[]; bin_mode: 'continuous' | 'categorical' }
      > = {};
      for (const [tag, ref] of Object.entries(reference)) {
        if (ref && tag !== targetColumn) {
          references[tag] = { edges: ref.edges, bin_mode: ref.binMode };
        }
      }
      try {
        const result = await inferenceWindowInputSeries({
          windows: windows.map((w) => ({
            key: w.inputKey!,
            window_start: w.windowStart.toISOString(),
            window_end: w.windowEnd.toISOString(),
          })),
          // Empty: every feature column the input frames carry, so a tag
          // with no recorded range still shows its trend (as UNKNOWN).
          columns: [],
          references,
          max_points: DRIFT_TREND_MAX_POINTS,
        });
        missing = result.missing;
        const features = Object.fromEntries(
          Object.entries(result.columns).filter(([c]) => c !== targetColumn),
        );
        graded = gradeSeries(features, reference, thresholds);
      } catch (err) {
        // Fail SOFT, the same judgement `getScheduledSeriesService` makes:
        // an unreachable object store reads as "no input values", counted
        // in `missing`, never as a broken Monitoring tab.
        this.log.warn(
          `Input series read failed for model ${modelId}: ${(err as Error).message}`,
        );
        missing = windows.length;
      }
    }

    const target = computeTargetDrift(
      targetColumn,
      windows.map(
        (w) => w.targetHistogram as unknown as FeatureHistogram | null,
      ),
      reference,
      thresholds,
    );

    return {
      statusCode: 200,
      message: 'Input drift report fetched',
      type: 'SUCCESS' as const,
      data: {
        ...graded.report,
        targetColumn,
        target,
        series: graded.series,
        basis: {
          plane: 'window' as const,
          modelVersionId: production.id,
          version: production.version,
          from,
          to,
          windowsUsed: windows.length,
          capped,
          maxDays: DRIFT_RANGE_MAX_DAYS,
          truncated: false,
          missing,
          healthWindows: PRODUCTION_WINDOW_TAKE,
          thresholds,
        },
      },
    };
  }

  /**
   * MODEL-SERVE-001-T21. The health axis — SEPARATE from `deployStatus`,
   * per `lib/model-health.ts`'s own doc comment. Reuses `computeRangeDrift`
   * unchanged, with the same env thresholds `getInputDriftReport` above uses.
   * MODEL-SERVE-028: PSI is the only input-drift axis.
   *
   * NEVER THROWS. `getInputDriftReport` is an explicit,
   * user-requested reports, so a 404 for "no PRODUCTION version" is the
   * right response; this is a badge fed by every model detail page load,
   * decided PURELY INFORMATIONAL by the user (2026-09-15) — a hard error
   * here would fail the whole `getStatusService` response over a signal
   * nobody asked to see fail loudly. Every "nothing to classify yet" case
   * (no schedule, monitoring off, no PRODUCTION version, no windows with
   * usable stats) is a normal result, not an exception.
   */
  async getHealthStatus(modelId: string): Promise<{
    status: HealthStatus;
    reason: HealthReason | null;
    frozenColumns: string[];
    /** MODEL-SERVE-028. The schedule's residual-SD bands (lib/residual-sd-
     *  health.ts). Since the z-score drift axis was removed these are the
     *  ONLY thing `warnSd`/`criticalSd` threshold. Null when no schedule. */
    thresholds: { warnSd: number; criticalSd: number } | null;
    /** MODEL-SERVE-009-T03. SINCE WHEN each badged column last changed —
     *  evidence beside T29's badge, never a second detector. ANNOTATED
     *  rather than inferred, and present-and-empty on every early-return
     *  branch: T29's own review follow-up found that an inferred return
     *  type let a branch omit `frozenColumns` while the client's type
     *  required it, so the server silently under-delivered on the most
     *  common shape there is (a model with no schedule row). */
    frozenSince: Array<{
      column: string;
      lastChangedAt: string | null;
      flatMinutes: number | null;
    }>;
    /** MODEL-SERVE-012. Both halves of the output-error comparison beside
     *  the verdict — the live spread, the reference it was measured
     *  against, their ratio, and the pair count behind it. ANNOTATED and
     *  present on every branch, for the reason the comment above records:
     *  an inferred return type let an early branch omit a field the client
     *  required. A no-schedule model reports UNKNOWN with nulls, never a
     *  zero ratio. */
    residualSd: ResidualSdVerdict;
    /** MODEL-SERVE-031. The worst-column PSI and the largest out-of-range
     *  share beside the verdict, so a digest can show the numbers. Null when
     *  there is no PSI evidence (no schedule, drift off, no reference). */
    driftSummary: DriftSummary | null;
  }> {
    const schedule = await this.prisma.inferenceSchedule.findUnique({
      where: { modelId },
    });
    if (!schedule) {
      return {
        status: 'OFF',
        reason: null,
        frozenColumns: [],
        thresholds: null,
        frozenSince: [],
        driftSummary: null,
        // No schedule means nothing has ever been scored, so there is no
        // spread to report — UNKNOWN with nulls, never a zero.
        residualSd: {
          status: 'UNKNOWN',
          liveSd: null,
          ratio: null,
          baselineSd: null,
          n: 0,
        },
      };
    }

    // MODEL-SERVE-001-T26. The liveness inputs, resolved BEFORE the
    // driftMonitor gate below: an enabled schedule reports its fetch faults
    // and its staleness whether or not anyone opted into drift watching. See
    // `classifyModelHealth`'s own comment for why that gate covers drift only
    // — `driftMonitor` defaults to false, and gating liveness behind it would
    // re-create exactly the calm-dashboard blindness T26 exists to remove.
    const faults = await this.resolveLivenessFaults(schedule);
    const thresholds = {
      warnSd: schedule.warnSd,
      criticalSd: schedule.criticalSd,
    };

    // T27/T28's own bands, read off the schedule rather than env — see
    // schema.prisma's doc comment for why one global constant is evaluated
    // against the wrong axis the moment two schedules differ.
    const bands = {
      skipStreakAlert: schedule.skipStreakAlert,
      missingPctWarn: schedule.missingPctWarn,
      missingPctAlert: schedule.missingPctAlert,
    };

    // T27/T29. RESOLVED ONCE, feeding BOTH PSI and frozen — the previous
    // shape returned early when driftMonitor was off and never looked at a
    // window at all, which would have made Sensor Frozen invisible for every
    // model that had not opted into drift watching (the majority: it defaults
    // false). Frozen is a liveness fact about an instrument, not a drift
    // claim, so it follows T26's rule and is NOT gated behind that flag.
    let windows: Awaited<
      ReturnType<InferenceWindowMonitoringService['resolveProductionWindows']>
    >['windows'] = [];
    let production:
      | Awaited<
          ReturnType<
            InferenceWindowMonitoringService['resolveProductionWindows']
          >
        >['production']
      | null = null;
    try {
      ({ production, windows } = await this.resolveProductionWindows(modelId));
    } catch (err) {
      // No PRODUCTION version — nothing to compare against yet, and nothing
      // to read stillness from either. A fault still outranks it: "we cannot
      // read the source" is a more useful answer than "we have nothing to
      // compare against".
      if (!(err instanceof AppException)) throw err;
    }

    const statsRows = windows
      .map((w) => w.featureStats)
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .map((s) => s as unknown as FeatureStatsMap);

    // The BASELINE IS FETCHED ONLY WHEN THERE IS SOMETHING TO COMPARE IT TO.
    // It is an HTTP round trip to apps/python, and frozen detection below
    // needs window stats to say anything at all — so a model with no stats
    // costs nothing extra.
    const baseline =
      production && statsRows.length > 0
        ? await resolveColumnBaseline(production.goldObjectKey)
        : {};

    // T29. Newest-first, limited to the schedule's own frozenWindows.
    // The `frozenWindows <= PRODUCTION_WINDOW_TAKE` bound is owned by the DTO
    // (`.max(24)`), NOT clamped here: a clamp would silently badge frozen off
    // FEWER windows than the operator asked for. `detectFrozenColumns` returns
    // [] when the sample is short, which is the honest answer — not enough
    // evidence, rather than a quietly weakened threshold.
    const frozenColumns = detectFrozenColumns({
      windows: statsRows,
      baseline,
      frozenWindows: schedule.frozenWindows,
      frozenTolerancePct: schedule.frozenTolerancePct,
    });

    // MODEL-SERVE-001-T32, sole input-drift axis since MODEL-SERVE-028.
    // Resolved here rather than left to the report path, so the badge and
    // the PSI card grade the same rolling-24 windows.
    //
    // T27 RULE (2), THE DARK-SHIP GATE: PSI may only speak when there IS
    // evidence — a non-empty frozen `psiRefEdges` reference AND at least one
    // window carrying a histogram. `resolveDriftReference` returns `{}` from
    // its SUCCESS path as well as its catch path, so without this an
    // artifact whose feature_spec read failed would report healthy. Live
    // 2026-10-04: 2 of 3 scheduled models carry no histograms at all, so
    // this is the live case. The reference read is an HTTP round trip,
    // so it is skipped entirely unless drift watching is on AND some window
    // actually carried a histogram — the same "fetch only when there is
    // something to compare" discipline the baseline above follows.
    const healthHistogramRows = windows
      // `!= null`, not `!== null` like the report path above: a window row
      // can reach this method with the column ABSENT rather than null, and
      // letting `undefined` through would fetch the PSI reference — an HTTP
      // round trip — for a model with no histogram to compare it against.
      .filter((w) => w.featureHistograms != null)
      .map((w) => w.featureHistograms as unknown as FeatureHistogramMap);

    const psiReference =
      production && schedule.driftMonitor && healthHistogramRows.length > 0
        ? await resolveDriftReference(production.goldObjectKey)
        : {};
    const driftEvidence =
      healthHistogramRows.length > 0 && Object.keys(psiReference).length > 0;

    // INSUFFICIENT_DATA and UNKNOWN reach `classifyModelHealth` as
    // themselves and raise nothing there — `computeRangeDrift` publishes no numeric
    // PSI below its sample floor, and this method must not turn that silence
    // into either an alarm or a clean bill of health.
    const psiReport = driftEvidence
      ? computeRangeDrift(
          poolHistograms(healthHistogramRows),
          psiReference,
          driftThresholds(),
        )
      : null;
    const driftStatus = psiReport ? psiReport.status : null;

    // MODEL-SERVE-009-T03. EVIDENCE BESIDE THE BADGE, NOT A SECOND DETECTOR.
    // MODEL-SERVE-001-T29 still decides WHICH columns are frozen, by its own
    // three-window pooled range and its own five guards — untouched, along
    // with frozenWindows/frozenTolerancePct and the Offline > Alert > Frozen
    // > Warning > Normal precedence. What T02's per-tag row adds is SINCE
    // WHEN, which the pooled range cannot say: it quantises to whole windows
    // (a tag flat 2h50m reads as moving at a 60-minute cadence) and carries
    // no timestamp at all.
    //
    // DELIBERATELY NOT USED TO DETECT. Replacing T29's evidence was
    // considered and declined (user decision 2026-09-17): the timestamp data
    // was still at first sighting, so the quantisation difference could not
    // be demonstrated on real data, and rewriting a shipped, tested signal
    // on an undemonstrated difference is the trade this ledger keeps
    // refusing. The replacement stays open, on evidence.
    //
    // A column T29 badges with NO TagObservation row yields no entry rather
    // than a zero duration — a model whose rows predate this feature, or a
    // tag never yet fetched, is UNKNOWN, and MODEL-SERVE-001-T27's rule is
    // that UNKNOWN never folds into a confident value.
    const frozenSince =
      frozenColumns.length > 0
        ? (
            await this.prisma.tagObservation.findMany({
              where: { modelId, tag: { in: frozenColumns } },
              select: { tag: true, lastChangedAt: true, lastSeenAt: true },
            })
          )
            .map((row) => ({
              column: row.tag,
              lastChangedAt: row.lastChangedAt?.toISOString() ?? null,
              flatMinutes: flatMinutes(row),
            }))
            // Null flatMinutes means a timestamp is missing — "we do not
            // know how long", which is not "it changed just now".
            .filter((e) => e.lastChangedAt !== null)
        : [];

    // MODEL-SERVE-012. THE OUTPUT-ERROR AXIS. One query over the SAME
    // production version the PSI half already resolved —
    // `InferenceWindowTruth` carries sufficient statistics per window, so the
    // pooled live residual SD needs no object read and no second HTTP round
    // trip.
    //
    // Runs even when `driftMonitor` is off, and even when there is no
    // baseline artifact: this axis compares the model against ITS OWN
    // recorded error, not against a column baseline, so nothing above gates
    // it. `classifyResidualSd` answers UNKNOWN whenever the comparison
    // cannot be made.
    const residualSd = classifyResidualSd({
      windows: production
        ? await this.prisma.inferenceWindowTruth.findMany({
            // A TIME horizon, not a row count, and the SAME one
            // `deriveDeployStatuses` bounds its grouped aggregate by — see
            // `TRUTH_POOL_DAYS`. A row-count `take` cannot be expressed as a
            // group-by bound, so the list could not have matched it, and two
            // bounds would let the list badge and this badge grade the same
            // model from different samples.
            //
            // DELIBERATELY NOT `PRODUCTION_WINDOW_TAKE`: that is 24 windows
            // because drift reads a rolling day of feature stats. A residual
            // needs a MEASURED lab actual, which arrives at roughly daily
            // cadence, so a one-day horizon could never reach
            // `MIN_RESIDUAL_SD_PAIRS` and the axis would report UNKNOWN
            // forever — a silent no-op no test would catch, since every test
            // supplies its own rows.
            where: {
              modelVersionId: production.id,
              windowStart: { gte: truthPoolSince() },
            },
            orderBy: { windowStart: 'desc' },
            select: {
              n: true,
              sumSe: true,
              sumAe: true,
              sumSigned: true,
              sumActual: true,
              sumActualSq: true,
            },
          })
        : [],
      baselineSd: baselineResidualSd(production?.metrics ?? null),
      thresholds: {
        warnSd: schedule.warnSd,
        criticalSd: schedule.criticalSd,
      },
    });

    return {
      ...classifyModelHealth({
        enabled: schedule.enabled,
        driftMonitor: schedule.driftMonitor,
        driftStatus,
        driftEvidence,
        frozenColumns,
        residualSdStatus: residualSd.status,
        ...bands,
        ...faults,
      }),
      thresholds,
      frozenSince,
      driftSummary: psiReport ? summarizeDrift(psiReport) : null,
      // The two halves of the comparison, beside the verdict — a reader can
      // see WHICH numbers produced it rather than being handed a word.
      residualSd,
    };
  }

  /**
   * MODEL-SERVE-001-T26. The two liveness signals the deploy axis used to
   * own, read from the rows they already live on.
   *
   * `consecutiveFailures` counts back from the NEWEST terminal window and
   * stops at the first non-FAILED one — a genuine trailing run, not "3 of the
   * last 3 happen to be FAILED in any order". The take-3 sample and the
   * SUCCEEDED/SKIPPED/FAILED filter are the same ones `deriveDeployStatuses`
   * uses, deliberately: the two axes must not disagree about what the recent
   * history was.
   *
   * SKIPPED IS NOT COUNTED AS A FAILURE. T01/T10/T11 each state that it is a
   * legitimate terminal status for a quiet plant and must neither raise nor
   * suppress the alarm; a consecutive SKIPPED run is T27's NO_PREDICTIONS,
   * with its own reason code, not this one.
   *
   * Staleness is measured from the last SUCCEEDED/SKIPPED window, matching
   * `deriveDeployStatuses`'s own `lastSucceededAt` — a stream of FAILED
   * windows means the record HAS stopped being written, which is the thing
   * staleness is asking about.
   */
  private async resolveLivenessFaults(schedule: {
    modelId: string;
    enabled: boolean;
    cadenceMinutes: number;
    lagMinutes: number;
    skipStreakAlert: number;
  }): Promise<{
    consecutiveFailures: number;
    consecutiveSkips: number;
    missingPct: number | null;
    staleness: 'OK' | 'STALE';
    hasEverSucceeded: boolean;
  }> {
    if (!schedule.enabled) {
      return {
        consecutiveFailures: 0,
        consecutiveSkips: 0,
        missingPct: null,
        staleness: 'OK',
        hasEverSucceeded: false,
      };
    }

    // WIDENED FROM A HARD-CODED 3 (T27/T28). The failure bar is 3, but
    // `skipStreakAlert` is operator-set: against a fixed take-3 sample a
    // setting of 5 could NEVER fire, silently — the "settings that appear to
    // work and may do nothing" defect T21's audit found. The sample is now
    // whatever the largest streak in play needs.
    const sampleSize = Math.max(3, schedule.skipStreakAlert);
    const recentTerminal = await this.prisma.inferenceWindow.findMany({
      where: {
        modelId: schedule.modelId,
        status: { in: ['SUCCEEDED', 'SKIPPED', 'FAILED'] },
      },
      orderBy: { windowStart: 'desc' },
      take: sampleSize,
      select: { status: true, missingPct: true },
    });
    let consecutiveFailures = 0;
    for (const w of recentTerminal) {
      if (w.status !== 'FAILED') break;
      consecutiveFailures += 1;
    }
    // A RUN, counted the same way, for the same reason: "3 of the last 5 were
    // SKIPPED in any order" is a quiet plant; three in a ROW is predictions
    // having stopped.
    let consecutiveSkips = 0;
    for (const w of recentTerminal) {
      if (w.status !== 'SKIPPED') break;
      consecutiveSkips += 1;
    }

    const lastProduced = await this.prisma.inferenceWindow.findFirst({
      where: {
        modelId: schedule.modelId,
        status: { in: ['SUCCEEDED', 'SKIPPED'] },
      },
      orderBy: { windowStart: 'desc' },
      select: { windowStart: true },
    });

    return {
      consecutiveFailures,
      consecutiveSkips,
      // THE NEWEST terminal window's own share of Bad cells, not a rollup
      // across the sample. The band answers "is the data bad RIGHT NOW"; a
      // rollup answers a different question and disagrees with this one on a
      // plant that has just recovered.
      missingPct: recentTerminal[0]?.missingPct ?? null,
      // Separates "stopped being written" from "has not started yet" — see
      // classifyModelHealth's own note on why the latter must not alarm.
      hasEverSucceeded: lastProduced !== null,
      // T11's function, called — never a third copy of the formula.
      staleness: isStale(
        lastProduced?.windowStart ?? null,
        schedule.cadenceMinutes,
        schedule.lagMinutes,
      ),
    };
  }
}
