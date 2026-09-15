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
   */
  private async resolveProductionWindows(
    modelId: string,
    from: string,
    to: string,
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
        windowStart: { gte: new Date(from), lte: new Date(to) },
      },
      orderBy: { windowStart: 'desc' },
      take: 24,
      select: {
        windowStart: true,
        status: true,
        inputRows: true,
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
}
