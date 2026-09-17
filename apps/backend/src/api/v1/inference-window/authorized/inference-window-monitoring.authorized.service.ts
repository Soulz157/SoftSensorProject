import { Injectable } from '@nestjs/common';
import { PrismaService } from '@softsensor/prisma';
import { AppException } from '@softsensor/common';
import { env } from '@/config/env.config';
import {
  computeDrift,
  poolFeatureStats,
  type FeatureStatsMap,
} from '@/lib/prediction-drift';
import {
  computePsi,
  poolHistograms,
  PSI_EPSILON,
  type FeatureHistogramMap,
} from '@/lib/prediction-psi';
import {
  resolveColumnBaseline,
  resolvePsiReference,
} from '@/lib/artifact-baseline';
import { flatMinutes } from '@/lib/tag-observation';
import {
  classifyModelHealth,
  thresholdsFromSchedule,
  type HealthStatus,
  type HealthReason,
} from '@/lib/model-health';
// MODEL-SERVE-001-T26. T11's staleness formula, called rather than copied —
// it moved axes, it did not fork.
import { isStale } from '@/lib/deploy-status';
// MODEL-SERVE-001-T29. The frozen-tag detector, pure and co-located with its
// own spec like the other 13 modules in lib/.
import { detectFrozenColumns } from '@/lib/sensor-frozen';

/**
 * `resolveProductionWindows`'s own `take`. Named because T29's
 * `frozenWindows` is clamped against it: a setting larger than the sample
 * could never fire, which is precisely the "settings that appear to work and
 * may do nothing" defect T21's audit found and T28 exists to prevent.
 */
const PRODUCTION_WINDOW_TAKE = 24;

/**
 * MODEL-SERVE-001-T17. Drift/PSI, computed from `InferenceWindow`'s own
 * `featureStats`/`featureHistograms` — the WINDOW plane, for a model with a
 * scheduled `InferenceSchedule`. The `/predict`-only counterpart lives in
 * `PredictionLogAuthorizedService.getDriftService`/`getPsiService`, which
 * calls `hasSchedule` below to decide which plane a model reads from — see
 * that service's own doc comment for the full dispatch rule. Both planes
 * run the SAME pure comparison functions (`computeDrift`/`computePsi` from
 * `lib/prediction-drift.ts`/`lib/prediction-psi.ts`) and the SAME artifact
 * baseline reads (`lib/artifact-baseline.ts`) — only WHERE the live side of
 * the comparison is read from differs.
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
   * sufficient statistics pool ADDITIVELY (the same trick `poolFeatureStats`
   * and `InferenceWindowTruth` already use elsewhere in this system), so a
   * rolling figure over the most recent 24 windows is EXACT, never an
   * average of averages — T17's own resolved cadence decision.
   *
   * NEVER FILTERED BY `status` AT THE QUERY LEVEL. A window feeds this pool
   * exactly when it carries a stored histogram/stats row, which happens
   * exactly when a real cleaned input frame was written — `put_frame` runs
   * before SKIPPED or FAILED is ever decided, so both still hold real,
   * cleaned input evidence. Status is DISCLOSURE (`basisOf`'s own
   * `statusBreakdown`), never a filter on which rows count.
   *
   * `from`/`to` OPTIONAL — MODEL-SERVE-001-T21's own addition. The two
   * existing callers (`getDriftReport`/`getPsiReport`) always pass an
   * explicit user-chosen range; `getHealthStatus` below has none to pass
   * (it is not answering "how did drift look in this window", it is
   * answering "what is the CURRENT health reading"), so it calls this with
   * neither and gets the rolling most-recent-24 with no date floor at all.
   */
  private async resolveProductionWindows(
    modelId: string,
    from?: string,
    to?: string,
  ) {
    const production = await this.prisma.modelVersion.findFirst({
      where: { modelId, stage: 'PRODUCTION' },
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
      },
    });

    return { production, windows };
  }

  /**
   * The window-plane-specific half of `basis`, shared by both reports
   * below — `plane`, `windowsUsed`, the real earliest/latest `windowStart`
   * (never a printed "rolling 24h": this range is only exactly that when
   * the pool happens to hold 24 windows spanning that long — T16's own
   * departure (1) restated one plane over), the per-status breakdown (the
   * disclosure this feature's own no-status-whitelist rule requires — a
   * figure computed mostly from windows that never scored must say so),
   * and the summed `inputRows` across the pool.
   */
  private basisOf(
    production: {
      id: string;
      version: number;
      goldArtifactId: string;
      goldObjectKey: string;
    },
    windows: Array<{
      windowStart: Date;
      status: string;
      inputRows: number | null;
    }>,
    from: string,
    to: string,
  ) {
    const statusBreakdown: Record<string, number> = {};
    let totalInputRows = 0;
    for (const w of windows) {
      statusBreakdown[w.status] = (statusBreakdown[w.status] ?? 0) + 1;
      totalInputRows += w.inputRows ?? 0;
    }
    // DESC order (resolveProductionWindows's own orderBy): the first row is
    // the latest window, the last is the earliest.
    const windowStartLatest = windows[0]?.windowStart.toISOString() ?? null;
    const windowStartEarliest =
      windows[windows.length - 1]?.windowStart.toISOString() ?? null;

    return {
      modelVersionId: production.id,
      version: production.version,
      goldArtifactId: production.goldArtifactId,
      goldObjectKey: production.goldObjectKey,
      plane: 'window' as const,
      // Parity with the /predict-plane basis's own `sampleRequests` — same
      // MEANING ("how many source records fed this pool"), reinterpreted
      // as windows rather than requests. `windowsUsed` is the plane-honest
      // name a caller can read without branching on `plane` first.
      sampleRequests: windows.length,
      windowsUsed: windows.length,
      windowStartEarliest,
      windowStartLatest,
      statusBreakdown,
      totalInputRows,
      from,
      to,
    };
  }

  async getDriftReport(modelId: string, from: string, to: string) {
    const { production, windows } = await this.resolveProductionWindows(
      modelId,
      from,
      to,
    );

    // MODEL-SERVE-001-T17. `featureStats` is nullable at the ROW level (a
    // window written before this task, or one whose spec carried no
    // usable scalingParams for any feature column) — filtered out BEFORE
    // `poolFeatureStats`, same discipline `getPsiReport`/the existing
    // /predict-plane `getPsiService` already apply to `featureHistograms`.
    const statsRows = windows
      .map((w) => w.featureStats)
      .filter((s): s is NonNullable<typeof s> => s !== null);

    const pooled = poolFeatureStats(
      statsRows.map((s) => s as unknown as FeatureStatsMap),
    );
    const baseline = await resolveColumnBaseline(production.goldObjectKey);
    const report = computeDrift(pooled, baseline, {
      warnSd: env.DRIFT_WARN_SD,
      criticalSd: env.DRIFT_CRITICAL_SD,
      outOfRangePct: env.DRIFT_OUT_OF_RANGE_PCT,
    });

    return {
      statusCode: 200,
      message: 'Drift report fetched',
      type: 'SUCCESS' as const,
      data: {
        ...report,
        basis: {
          ...this.basisOf(production, windows, from, to),
          // The honest "actually contributed" count, mirroring the
          // /predict-plane PSI basis's own `histogramRequests` — windows
          // fetched (`windowsUsed`) can exceed this whenever a window
          // predates T17 or had no coverable feature column.
          statsWindows: statsRows.length,
        },
      },
    };
  }

  async getPsiReport(modelId: string, from: string, to: string) {
    const { production, windows } = await this.resolveProductionWindows(
      modelId,
      from,
      to,
    );

    const histogramRows = windows
      .map((w) => w.featureHistograms)
      .filter((h): h is NonNullable<typeof h> => h !== null);

    const pooled = poolHistograms(
      histogramRows.map((h) => h as unknown as FeatureHistogramMap),
    );
    const reference = await resolvePsiReference(production.goldObjectKey);
    const report = computePsi(pooled, reference, {
      warn: env.PSI_WARN,
      critical: env.PSI_CRITICAL,
      minSamplesPerBin: env.PSI_MIN_SAMPLES_PER_BIN,
    });

    return {
      statusCode: 200,
      message: 'PSI report fetched',
      type: 'SUCCESS' as const,
      data: {
        ...report,
        basis: {
          ...this.basisOf(production, windows, from, to),
          histogramRequests: histogramRows.length,
          thresholds: {
            warn: env.PSI_WARN,
            critical: env.PSI_CRITICAL,
            minSamplesPerBin: env.PSI_MIN_SAMPLES_PER_BIN,
          },
          epsilon: PSI_EPSILON,
        },
      },
    };
  }

  /**
   * MODEL-SERVE-001-T21. The health axis — SEPARATE from `deployStatus`,
   * per `lib/model-health.ts`'s own doc comment. Reuses `computeDrift`
   * unchanged; the only thing this method changes from `getDriftReport`
   * above is WHERE the thresholds come from (this schedule's own
   * warnSd/criticalSd/driftThresholdPct, `lib/model-health.ts`'s
   * `thresholdsFromSchedule`) rather than the system-wide env vars — the
   * existing Drift tab/report keeps reading those, untouched by this task.
   *
   * NEVER THROWS. `getDriftReport`/`getPsiReport` are explicit,
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
    thresholds: ReturnType<typeof thresholdsFromSchedule> | null;
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
      };
    }

    // MODEL-SERVE-001-T26. The liveness inputs, resolved BEFORE the
    // driftMonitor gate below: an enabled schedule reports its fetch faults
    // and its staleness whether or not anyone opted into drift watching. See
    // `classifyModelHealth`'s own comment for why that gate covers drift only
    // — `driftMonitor` defaults to false, and gating liveness behind it would
    // re-create exactly the calm-dashboard blindness T26 exists to remove.
    const faults = await this.resolveLivenessFaults(schedule);
    const thresholds = schedule.driftMonitor
      ? thresholdsFromSchedule(schedule)
      : null;

    // T27/T28's own bands, read off the schedule rather than env — see
    // schema.prisma's doc comment for why one global constant is evaluated
    // against the wrong axis the moment two schedules differ.
    const bands = {
      skipStreakAlert: schedule.skipStreakAlert,
      missingPctWarn: schedule.missingPctWarn,
      missingPctAlert: schedule.missingPctAlert,
    };

    // T27/T29. RESOLVED ONCE, feeding BOTH drift and frozen — the previous
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
    // It is an HTTP round trip to apps/python, and both consumers below need
    // window stats to say anything at all — so a model with no stats costs
    // nothing extra, which today is every model (no window has succeeded
    // since T17 added the column).
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

    // T27 RULE (2), THE DARK-SHIP GATE. Drift may only speak when there IS
    // evidence: a non-empty baseline AND at least one window carrying stats.
    // `resolveColumnBaseline` returns `{}` from its SUCCESS path as well as
    // its catch path, so without this an artifact whose column_stats read
    // failed would report healthy.
    const driftEvidence =
      statsRows.length > 0 && Object.keys(baseline).length > 0;

    const driftStatus =
      schedule.driftMonitor && driftEvidence && thresholds
        ? computeDrift(poolFeatureStats(statsRows), baseline, thresholds).status
        : null;

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

    return {
      ...classifyModelHealth({
        enabled: schedule.enabled,
        driftMonitor: schedule.driftMonitor,
        driftStatus,
        driftEvidence,
        frozenColumns,
        ...bands,
        ...faults,
      }),
      thresholds,
      frozenSince,
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
