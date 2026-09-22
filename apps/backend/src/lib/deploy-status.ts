import { PrismaService } from '@softsensor/prisma';
import { env } from '@/config/env.config';
import { redactUrls } from '@/lib/redact-urls';
// MODEL-SERVE-001-T26. The monitoring classifier, called from the list path
// so both axes are derived by ONE implementation each. Acyclic: model-health
// imports nothing from this module (it names it only in a comment).
import { classifyModelHealth, type ModelHealth } from '@/lib/model-health';
// MODEL-SERVE-012-T08. The output-error classifier and its horizon, called
// rather than reimplemented, so the list and the detail page grade a model by
// one rule over one sample. Acyclic: neither module imports this one.
import {
  classifyResidualSd,
  truthPoolSince,
  type ResidualSdStatus,
} from '@/lib/residual-sd-health';
import { baselineResidualSd } from '@/lib/model-version-residual-sd';
// MODEL-SERVE-001-T30 (list-payload frozen detection). THE SAME detector the
// single-model path uses (`InferenceWindowMonitoringService.getHealthStatus`)
// — one rule for "is this tag frozen", not a second one that could disagree
// with the detail page about the same tag.
import { detectFrozenColumns } from '@/lib/sensor-frozen';
// `resolveColumnBaseline`'s OWN caching (by `goldObjectKey`, an immutable
// artifact key) is what makes calling it here affordable — see its own doc
// comment. Without that cache this read would be an uncached HTTP round trip
// to apps/python per enabled model, on every Alerts/Overview/sidebar load.
import { resolveColumnBaseline } from '@/lib/artifact-baseline';
import type { FeatureStatsMap } from '@/lib/prediction-drift';

/**
 * MODEL-SERVE-006-T12. Per decisions.deploy_status_currently_asserts_
 * something_untrue: `Model.data.deployStatus` used to be whatever the last
 * caller wrote (`updateModel(modelId, { deployStatus: 'running' })`,
 * phase-6-deploy.tsx's old behaviour) — a claim nothing backed. Once
 * InferenceWindow rows exist, "is this deployed" has a real referent, and
 * this module is the ONE place that reads it — no caller sets it directly
 * anymore (`UpdateModelSchema` no longer accepts the field).
 *
 * `classifyDeployStatus` is the pure state machine, shared by the batched
 * list-derivation below AND `InferenceWindowAuthorizedService.
 * getStatusService`'s own single-model read — one implementation of what
 * the four statuses MEAN, not two that could drift apart.
 */
export type DeployStatus = 'stopped' | 'running' | 'error' | 'initializing';

/**
 * MODEL-SERVE-001-T24/T26. THE TWO-AXIS CONTRACT, in one sentence each:
 * DEPLOY answers "is the schedule alive and dispatching"; MONITORING
 * (lib/model-health.ts) answers "is the data and the model still right".
 * One classifier per axis, rendered together, never collapsed — a model that
 * is healthy-but-drifting, or failing-but-within-thresholds, has no
 * representable state once operational and health share one value. That is
 * why this enum is NOT widened with 'warning' or 'frozen', and why T21 put
 * the health classifier in its own file rather than growing this one.
 *
 * THE ENUM'S FOUR WIRE VALUES ARE FROZEN. They are not renamed to
 * 'failed'/'offline': T22 had just finished repairing three client maps that
 * keyed on the word 'failed' and fell through a `??` to green/Stopped, and
 * renaming manufactures a second round of the identical defect. The DISPLAY
 * labels changed instead ('error' -> "Failed", 'stopped' -> "Offline"), which
 * costs nothing on the wire.
 *
 * WHAT T26 CHANGED HERE, AND WHY THE OLD CONDITION COULD NOT SURVIVE:
 * `Running` is now STICKY. After preflight passes, only Offline takes the
 * deploy axis out of Running — an operator Stop, no PRODUCTION version, or no
 * schedule row. Fetch faults and staleness moved to the monitoring axis,
 * because "three windows failed" is a fact about the DATA, not about whether
 * the scheduler is dispatching.
 *
 * That made the previous `initializing` test unusable, not merely different.
 * It read `!hasEverSucceeded && !hasFailedWindows` — an INFERENCE from window
 * history about an event (did this schedule ever get a chance to work) that
 * nothing had recorded. Once Running must persist through failures, that
 * inference cannot separate warm-up from broken at all. T25 records the
 * evidence instead, so this stays a DERIVED read of a stored FACT — the same
 * class of thing as `promotedAt`, which is why T12's derive-at-read-time rule
 * still holds. `preflightOk` is not a status field.
 */
export function classifyDeployStatus(input: {
  enabled: boolean;
  hasEverSucceeded: boolean;
  /**
   * MODEL-SERVE-001-T25's recorded evidence. THE NULL IS LOAD-BEARING and is
   * emphatically not a soft pass: `true` = the source answered at enable,
   * `false` = it did not and the enable was refused, `null` = NOT PROBED (a
   * non-PI source, or a schedule enabled before T25 shipped).
   *
   * A `null` must never read as a failure — that would flip every schedule
   * enabled before this migration to Failed on the day it deploys, which is
   * the wrong direction in exactly the way this ledger keeps closing: a
   * verdict asserted from an observation nobody made.
   */
  preflightOk: boolean | null;
}): DeployStatus {
  if (!input.enabled) return 'stopped';
  // Reachable ONLY from preflight now. A window that fails later is the
  // monitoring axis's business.
  if (input.preflightOk === false) return 'error';
  // Not probed and nothing produced yet: genuinely still warming up. A probed
  // schedule (`true`) is Running from the press, which is the point — the
  // operator has already been told the source answers.
  if (input.preflightOk === null && !input.hasEverSucceeded) {
    return 'initializing';
  }
  return 'running';
}

/**
 * T11. Shared staleness input for `classifyDeployStatus`'s two callers
 * (`deriveDeployStatuses` below and `InferenceWindowAuthorizedService.
 * getStatusService`'s own single-model read) — the file's own state-machine
 * sharing above existed to stop the two disagreeing, but the staleness
 * *input* was still computed twice, inline, against `lastSucceededAt` alone.
 *
 * A window cannot reach SUCCEEDED/SKIPPED before `windowStart + cadence +
 * lag` (T11's own scheduler fix — a window is due only once it has both
 * elapsed AND cleared its ingestion lag), so that interval is counted as
 * processing time, not as silence, before `INFERENCE_STALE_AFTER_CADENCES`
 * starts counting missed cadences.
 *
 * THIS IS A REAL BEHAVIOUR CHANGE, STATED PLAINLY RATHER THAN AS "UNCHANGED
 * MEANING": at cadence=60/lag=15 the old inline calc allowed up to
 * `STALE_AFTER_CADENCES * cadence` (180min) measured from `windowStart`
 * alone, i.e. 180min raw. This function measures the same 180min from
 * `windowStart + cadence + lag` instead, so a genuinely dead schedule now
 * takes 75min LONGER to alarm (255min from windowStart, not 180). The trade
 * is deliberate — the scheduler fix pushed every window's own completion
 * one cadence later, and that interval is processing time a live schedule
 * always spends, not evidence of trouble — but it is a real widening of the
 * alarm's silence budget, not a no-op. Not `+1ms` at the boundary: the next
 * tick (seconds later) is what actually claims a window at the exact edge.
 *
 * Fails toward `'STALE'` (refusal, never a false "OK") on a non-finite
 * input — this ledger's consistent direction for an ungraded input,
 * matching T01's own SKIPPED-not-silent-pass shape. Load-bearing: three
 * pre-existing `deriveDeployStatuses` test fixtures were found passing
 * `lagMinutes: undefined` (fixed alongside this task), which without this
 * guard would compute `NaN` and silently read as permanently fresh.
 */
export function isStale(
  lastWindowStart: Date | null,
  cadenceMinutes: number,
  lagMinutes: number,
): 'OK' | 'STALE' {
  if (!lastWindowStart) return 'STALE';
  if (!Number.isFinite(cadenceMinutes) || !Number.isFinite(lagMinutes)) {
    return 'STALE';
  }
  const processableAt =
    lastWindowStart.getTime() + (cadenceMinutes + lagMinutes) * 60_000;
  const staleAfterMs =
    env.INFERENCE_STALE_AFTER_CADENCES * cadenceMinutes * 60_000;
  return Date.now() - processableAt > staleAfterMs ? 'STALE' : 'OK';
}

/**
 * MODEL-SERVE-001-T19. `status` alone cannot drive a Start/Stop control:
 * `enabled` is the setting the operator owns and writes, `status` is
 * DERIVED from windows and answers a different question ("is it actually
 * producing"). A control bound to `status` has no honest position for an
 * enabled-but-failing schedule — see this task's own audit. Every reader
 * of `DeployStatus` gets both from here on, so there is one place that
 * pairs them rather than each call site reaching past this module for the
 * schedule row itself.
 */
export interface DeployState {
  status: DeployStatus;
  enabled: boolean;
  /**
   * MODEL-SERVE-001-T23. The most recent FAILED window's own reason, for
   * the Alerts page — which builds its rows as a PURE function over the
   * models LIST (`apps/client/lib/alerts.ts`'s `buildAlerts`) and so cannot
   * fetch a per-model status without turning one page into N requests.
   *
   * It does not have to: `deriveDeployStatuses` below ALREADY reads the
   * last 3 terminal windows per enabled model for its `failing` check, so
   * this rides along on a query that was happening anyway. The fit is
   * exact rather than approximate — `classifyDeployStatus` only ever
   * returns 'error' for an ENABLED schedule, and that is precisely the set
   * the query covers, so every model the Alerts page treats as failed is
   * one this sample already fetched.
   *
   * `reason` is `redactUrls`-sanitized, for the same reason `getStatus
   * Service` sanitizes the same column: `completeService` stores the infer
   * container's `str(err)` VERBATIM, the one `failureReason` writer that is
   * never cleaned on the way in.
   *
   * Null when the sample holds no FAILED row at all. Deliberately NOT
   * sourced from `Model.data.logs` — that was never the deploy-failure
   * source of truth (this module reads InferenceWindow directly), which is
   * exactly why the filter T23 replaces was empty by construction.
   */
  lastFailure: { reason: string | null; at: Date } | null;
  /**
   * MODEL-SERVE-001-T26/T30. The MONITORING axis for the list payload, so
   * the Alerts page and the workspace failure counts keep seeing fetch
   * faults after they stopped reaching `status`. Drift is deliberately NOT
   * evaluated here — a drift VERDICT needs `warnSd`/`criticalSd` thresholds
   * this payload does not carry for that purpose, and reusing the frozen
   * detection's baseline call to also compute one would be a second
   * classifier decision this batched path was never asked to make. Frozen
   * detection IS evaluated here (T30): it reuses the SAME baseline read,
   * costing nothing extra once that call is already made for the window
   * query below. `OFF` on this path therefore means "no LIVE fault or
   * frozen tag, and no drift claim", never "healthy".
   */
  monitoring: ModelHealth;
}

/**
 * Batched derivation for a LIST of models (`getModelsService`/
 * `getWorkspaceModels`) — avoids N+1 queries. Non-N+1 reads (schedules, a
 * `groupBy` for each model's last SUCCEEDED/SKIPPED window, and a
 * `groupBy` for pooled output-error truth) plus, per ENABLED schedule: one
 * bounded `findMany` (widened by T30 to also carry `featureStats`, sized to
 * `frozenWindows`) and, when that window sample carries stats, one call to
 * `resolveColumnBaseline` — cached by `goldObjectKey` (see its own doc
 * comment), so repeat list loads for the same models cost no sidecar round
 * trip after the first. All of this is proportional to how many schedules
 * are actually enabled in the list, not to every model in the system.
 *
 * Returns a state for every id in `modelIds`, defaulting absent entries
 * (no schedule at all) to `{ status: 'stopped', enabled: false }`.
 */
export async function deriveDeployStatuses(
  prisma: PrismaService,
  modelIds: string[],
): Promise<Record<string, DeployState>> {
  const result: Record<string, DeployState> = {};
  for (const id of modelIds) {
    result[id] = {
      status: 'stopped',
      enabled: false,
      lastFailure: null,
      // No schedule row at all — nothing to watch, and nothing wrong.
      monitoring: { status: 'OFF', reason: null, frozenColumns: [] },
    };
  }
  if (modelIds.length === 0) return result;

  const schedules = await prisma.inferenceSchedule.findMany({
    where: { modelId: { in: modelIds } },
    select: {
      modelId: true,
      enabled: true,
      cadenceMinutes: true,
      lagMinutes: true,
      // MODEL-SERVE-001-T25/T26. Widens this SELECT only — same query, same
      // rows, same round trip, the shape T23 already established here.
      preflightOk: true,
      // T28's bands. Read here so the list's own monitoring verdict is
      // graded against the SAME per-schedule thresholds the detail page
      // uses, never a second set of defaults.
      skipStreakAlert: true,
      missingPctWarn: true,
      missingPctAlert: true,
      // MODEL-SERVE-012-T08. The output-error axis's own thresholds, read
      // here for the same reason the bands above are: the list's verdict is
      // graded against the SAME per-schedule numbers the detail page uses,
      // never a second set of defaults.
      warnSd: true,
      criticalSd: true,
      // MODEL-SERVE-001-T30 (list-payload frozen detection). The SAME two
      // numbers `detectFrozenColumns` needs on the single-model path — read
      // here so the list grades a tag frozen by the SAME rule the detail
      // page does, never a second set of defaults that could disagree.
      frozenWindows: true,
      frozenTolerancePct: true,
    },
  });
  if (schedules.length === 0) return result;

  const scheduleByModel = new Map(schedules.map((s) => [s.modelId, s]));
  const enabledIds = schedules.filter((s) => s.enabled).map((s) => s.modelId);

  const lastSucceededGroups = enabledIds.length
    ? await prisma.inferenceWindow.groupBy({
        by: ['modelId'],
        where: {
          modelId: { in: enabledIds },
          status: { in: ['SUCCEEDED', 'SKIPPED'] },
        },
        _max: { windowStart: true },
      })
    : [];
  const lastSucceededByModel = new Map(
    lastSucceededGroups.map((g) => [g.modelId, g._max.windowStart]),
  );

  // MODEL-SERVE-012-T08 / MODEL-SERVE-001-T30. THE PRODUCTION VERSION READ,
  // moved ahead of the per-model window query below (it used to sit after
  // it) because frozen detection now needs `goldObjectKey` INSIDE that loop.
  // Still one query for the whole page, never a per-model read — this is
  // why the output-error axis could always ride here while drift could not:
  // drift needs a per-model HTTP round trip to apps/python for the SAME
  // baseline this task now fetches too, made affordable by
  // `resolveColumnBaseline`'s own `goldObjectKey` cache (see its doc
  // comment) rather than by avoiding the call.
  const productionVersions = await prisma.modelVersion.findMany({
    where: { modelId: { in: modelIds }, stage: 'PRODUCTION' },
    select: { id: true, modelId: true, metrics: true, goldObjectKey: true },
  });
  const versionByModel = new Map(productionVersions.map((v) => [v.modelId, v]));

  // MODEL-SERVE-001-T26. `failingByModel`/`hasFailedByModel` are GONE, not
  // merely unread: three failed windows no longer says anything about whether
  // the schedule is dispatching, so computing them here and not using them
  // would leave a reader guessing which axis they belonged to. The same
  // signal now feeds the MONITORING axis (lib/model-health.ts) via
  // `getStatusService`. The window query below still serves `lastFailure`
  // exactly as it did — T30 widens its `take`/`select` to also serve frozen
  // detection, rather than adding a second per-model read for the Alerts
  // page to pay for.
  const lastFailureByModel = new Map<string, DeployState['lastFailure']>();
  // T26: the TRAILING run of failures, counted back from the newest and
  // stopping at the first non-FAILED row — the same rule
  // `resolveLivenessFaults` applies on the single-model path, so the list and
  // the detail page cannot disagree about the same three windows. SKIPPED is
  // not a failure (T01/T10/T11).
  const consecutiveFailuresByModel = new Map<string, number>();
  // MODEL-SERVE-001-T30. Per-model frozen columns, computed in the SAME loop
  // as `lastFailure`/`consecutiveFailures` — one Promise.all over enabled
  // models, not a second one.
  const frozenColumnsByModel = new Map<string, string[]>();
  await Promise.all(
    enabledIds.map(async (modelId) => {
      const schedule = scheduleByModel.get(modelId)!;
      // `take` widened from a flat 3 to whatever `frozenWindows` needs, the
      // same `Math.max(3, ...)` shape T27/T28 already used for
      // `skipStreakAlert` on the single-model path (resolveLivenessFaults) —
      // a fixed 3 against an operator-set 10 could never gather enough
      // evidence to badge anything, silently. Bounded by the DTO's own
      // `.max(24)` on `frozenWindows`, not clamped here, for the same reason
      // the single-model path does not clamp it: clamping would badge frozen
      // off FEWER windows than the operator asked for.
      const recentTerminal = await prisma.inferenceWindow.findMany({
        where: { modelId, status: { in: ['SUCCEEDED', 'SKIPPED', 'FAILED'] } },
        orderBy: { windowStart: 'desc' },
        take: Math.max(3, schedule.frozenWindows),
        // MODEL-SERVE-001-T23/T30: widens this SELECT only — same query,
        // same rows, same round trip. `featureStats` rides here for the
        // SAME reason `failureReason`/`windowStart` already do: a per-model
        // status read is what the Alerts page cannot afford, and this query
        // already runs per enabled model regardless.
        select: {
          status: true,
          failureReason: true,
          windowStart: true,
          featureStats: true,
        },
      });
      let streak = 0;
      for (const w of recentTerminal) {
        if (w.status !== 'FAILED') break;
        streak += 1;
      }
      consecutiveFailuresByModel.set(modelId, streak);
      // Already DESC by windowStart, so the first FAILED row is the most
      // recent one. Redacted here, not at the read site, so no caller can
      // forget: this column holds the infer container's verbatim `str(err)`.
      const failed = recentTerminal.find((w) => w.status === 'FAILED');
      lastFailureByModel.set(
        modelId,
        failed
          ? {
              reason: failed.failureReason
                ? redactUrls(failed.failureReason)
                : null,
              at: failed.windowStart,
            }
          : null,
      );

      // MODEL-SERVE-001-T30. THE SAME `statsRows` SHAPE the single-model
      // path builds (`getHealthStatus`'s own filter) — a window with no
      // stats is not a window with flat stats, so it is dropped before
      // `detectFrozenColumns` ever sees it, never coerced into a zero range.
      const statsRows = recentTerminal
        .map((w) => w.featureStats)
        .filter((s): s is NonNullable<typeof s> => s !== null)
        .map((s) => s as unknown as FeatureStatsMap);

      const production = versionByModel.get(modelId);
      // THE SAME DARK-SHIP GATE the single-model path applies: the baseline
      // is fetched ONLY when there is something to compare it to. A model
      // with no production version, or no window carrying stats, costs
      // nothing extra here — no sidecar call, no `detectFrozenColumns` call.
      if (!production || statsRows.length === 0) {
        frozenColumnsByModel.set(modelId, []);
        return;
      }

      const baseline = await resolveColumnBaseline(production.goldObjectKey);
      frozenColumnsByModel.set(
        modelId,
        detectFrozenColumns({
          windows: statsRows,
          baseline,
          frozenWindows: schedule.frozenWindows,
          frozenTolerancePct: schedule.frozenTolerancePct,
        }),
      );
    }),
  );

  // ONE aggregate over every production version at once. Bounded by the SAME
  // `TRUTH_POOL_DAYS` horizon `getHealthStatus` uses, so the list badge and
  // the detail badge grade the same model from the same sample — two
  // different bounds would let them disagree, which is the contradiction
  // this feature exists to remove.
  const truthGroups = productionVersions.length
    ? await prisma.inferenceWindowTruth.groupBy({
        by: ['modelVersionId'],
        where: {
          modelVersionId: { in: productionVersions.map((v) => v.id) },
          windowStart: { gte: truthPoolSince() },
        },
        _sum: {
          n: true,
          sumSe: true,
          sumAe: true,
          sumSigned: true,
          sumActual: true,
          sumActualSq: true,
        },
      })
    : [];
  const truthByVersion = new Map(
    truthGroups.map((g) => [
      g.modelVersionId,
      {
        // A group with no rows sums to null, which is zero pairs — and
        // `poolTruthStats` skips an n <= 0 row rather than adding its zeros.
        n: g._sum.n ?? 0,
        sumSe: g._sum.sumSe ?? 0,
        sumAe: g._sum.sumAe ?? 0,
        sumSigned: g._sum.sumSigned ?? 0,
        sumActual: g._sum.sumActual ?? 0,
        sumActualSq: g._sum.sumActualSq ?? 0,
      },
    ]),
  );

  const residualSdByModel = new Map<string, ResidualSdStatus>();
  for (const schedule of schedules) {
    const version = versionByModel.get(schedule.modelId);
    const pooled = version ? truthByVersion.get(version.id) : undefined;
    residualSdByModel.set(
      schedule.modelId,
      classifyResidualSd({
        windows: pooled ? [pooled] : [],
        baselineSd: baselineResidualSd(version?.metrics ?? null),
        thresholds: {
          warnSd: schedule.warnSd,
          criticalSd: schedule.criticalSd,
        },
      }).status,
    );
  }

  for (const schedule of schedules) {
    const lastSucceededAt = lastSucceededByModel.get(schedule.modelId) ?? null;
    result[schedule.modelId] = {
      status: classifyDeployStatus({
        enabled: schedule.enabled,
        hasEverSucceeded: lastSucceededAt !== null,
        preflightOk: schedule.preflightOk,
      }),
      enabled: schedule.enabled,
      lastFailure: lastFailureByModel.get(schedule.modelId) ?? null,
      // MODEL-SERVE-001-T26. The monitoring verdict rides THIS payload, from
      // rows already fetched above — no new query, no N+1. Without it, moving
      // fetch faults off the deploy axis would have silenced the Alerts page
      // and the workspace failure counts, which key on `deployStatus ===
      // 'error'` through `isDeployFailed` (client lib/model-status.ts). That
      // is the same "both axes read healthy while the scheduler is dead"
      // failure this task exists to prevent, displaced from the detail page
      // to the list. T30 owns the full surface; this is the minimum that
      // keeps the signal from disappearing in the meantime.
      monitoring: classifyModelHealth({
        enabled: schedule.enabled,
        // Drift is NOT evaluated on the list path — it needs a baseline read
        // per model, which is exactly the per-model request this batched
        // derivation exists to avoid. `false` here means "this payload makes
        // no drift claim", and the detail page's own read still does.
        driftMonitor: false,
        driftStatus: null,
        driftEvidence: false,
        // T27's `missingPct` band is STILL the detail page's job alone: it
        // reads the NEWEST terminal window's own missingPct ("is the data
        // bad RIGHT NOW"), which this batched query has no per-model reason
        // to fetch. `null` here means "this payload makes no BAD_DATA
        // claim", same discipline as drift above.
        consecutiveSkips: 0,
        skipStreakAlert: schedule.skipStreakAlert,
        missingPct: null,
        missingPctWarn: schedule.missingPctWarn,
        missingPctAlert: schedule.missingPctAlert,
        // MODEL-SERVE-001-T30. NO LONGER HARDCODED. Computed above in the
        // same Promise.all as `lastFailure`/`consecutiveFailures`, by the
        // SAME `detectFrozenColumns` the detail page calls, against the
        // SAME `frozenWindows`/`frozenTolerancePct` — so the list and the
        // detail page cannot disagree about which tags are frozen.
        frozenColumns: frozenColumnsByModel.get(schedule.modelId) ?? [],
        consecutiveFailures:
          consecutiveFailuresByModel.get(schedule.modelId) ?? 0,
        staleness: isStale(
          lastSucceededAt,
          schedule.cadenceMinutes,
          schedule.lagMinutes,
        ),
        hasEverSucceeded: lastSucceededAt !== null,
        // MODEL-SERVE-012-T08. A real graded verdict rather than a "no
        // claim", pooled above in two grouped queries for the whole page —
        // frozenColumns above is the other one, computed per-model instead
        // because `detectFrozenColumns` needs per-window identity, not an
        // aggregate. UNKNOWN when the model has no production version, no
        // reference SD, or too few joined pairs — and UNKNOWN never becomes
        // OK.
        residualSdStatus: residualSdByModel.get(schedule.modelId) ?? 'UNKNOWN',
      }),
    };
  }

  return result;
}

/**
 * Overlays a derived deploy state onto one model row's `data` blob for a
 * response — the ONE merge shape every read site (`getModelsService`,
 * `updateModelService`, `appendLogService`, `getWorkspaceModels`) now uses,
 * so "derive at read time" means the same thing everywhere it happens.
 * Never mutates the input; returns a new object.
 *
 * MODEL-SERVE-001-T19: carries `enabled` alongside `deployStatus` — a
 * Start/Stop control needs the setting the operator owns, not only the
 * fact derived from it. See `DeployState`'s own doc for why one cannot
 * stand in for the other.
 */
export function overlayDeployStatus<T extends { id: string; data: unknown }>(
  model: T,
  state: DeployState,
): T {
  const current =
    model.data && typeof model.data === 'object' && !Array.isArray(model.data)
      ? (model.data as Record<string, unknown>)
      : {};
  return {
    ...model,
    data: {
      ...current,
      deployStatus: state.status,
      enabled: state.enabled,
      // MODEL-SERVE-001-T23. Carried the same way `deployStatus`/`enabled`
      // already are, so the Alerts page reads a REAL failure reason off the
      // list payload it already fetches — see DeployState.lastFailure.
      lastFailure: state.lastFailure,
      // MODEL-SERVE-001-T26. Same reasoning, one axis over: the list payload
      // has to carry the monitoring verdict or the Alerts page cannot see a
      // fetch fault at all now that `deployStatus` no longer reports one.
      monitoring: state.monitoring,
    },
  };
}
