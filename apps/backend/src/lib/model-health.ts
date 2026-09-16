import type { DriftStatus, DriftThresholds } from './prediction-drift';

/**
 * MODEL-SERVE-001-T21. The HEALTH axis — a SEPARATE signal from
 * `DeployStatus` (lib/deploy-status.ts), never collapsed into it: a model
 * can be `running` (operationally up, serving traffic) while its inputs are
 * drifting, and a model that is `stopped` has no health reading at all.
 * Mirrors deploy-status.ts's own shape — a pure classifier plus a
 * pure threshold-derivation helper, each independently testable, with the
 * actual I/O (schedule read, window pooling, baseline resolve) living in
 * the caller (`InferenceWindowMonitoringService.getHealthStatus`).
 *
 * DECIDED BY THE USER (2026-09-15): purely informational. This axis does
 * not block a promote, does not pause a schedule, and does not trigger
 * `autoRetrain` — it renders as its own badge beside `deployStatus`/
 * `prodStatus`, nothing more. `autoRetrain` stays unwired by this task,
 * exactly as this ledger item's own audit found it; wiring it up is a
 * separate, larger decision (a trigger point, a re-trigger/cooldown rule)
 * this task deliberately does not make.
 */
export type HealthStatus =
  | 'OFF'
  | 'UNKNOWN'
  | 'OK'
  | 'WARN'
  | 'CRITICAL'
  | 'ALERT'
  | 'FROZEN';

/**
 * MODEL-SERVE-001-T26, completed by T27. EVERY ALERT CARRIES A REASON CODE,
 * because Alert collapses faults with OPPOSITE ACTIONS:
 * `SOURCE_UNREACHABLE` / `NO_PREDICTIONS` / `STALE` send a reader to the
 * connector or the scheduler; `SENSOR_FROZEN` sends them to one specific
 * instrument; `BAD_DATA` to the cells the fetch returned; `DRIFT_*` to the
 * process or to a retrain. Collapsing them into one word is what T16 refused
 * when it declined to put PSI in the z-score's table. The reason is RENDERED,
 * never inferred at read time — the pipelineVersion-with-a-default defect
 * DS-LAKE-022-T03 records.
 *
 * `TAG_MISSING` IS DELIBERATELY ABSENT, and this is a finding rather than an
 * omission. T27 names it, but says structural tag-missing should already have
 * been caught by T25's enable-time preflight. More decisively: the only
 * signal available on this side is a column absent from `featureStats`, and
 * that is AMBIGUOUS — `_scaled_feature_stats` excludes any tag whose scaler
 * is not "none" and which has no `scalingParams` entry, a legitimate and
 * expected state. Emitting TAG_MISSING on that signal would report a missing
 * tag for a correctly-configured column. It needs a real per-tag liveness
 * read (T15's probe), not an inference from absence.
 */
export type HealthReason =
  | 'SOURCE_UNREACHABLE'
  | 'STALE'
  | 'NO_PREDICTIONS'
  | 'BAD_DATA'
  | 'SENSOR_FROZEN'
  | 'DRIFT_CRITICAL'
  | 'DRIFT_WARN';

export interface ModelHealth {
  status: HealthStatus;
  /** Null only for the states that carry no fault at all (OFF / UNKNOWN /
   *  OK). Every graded state names WHY, per T27's own rule. */
  reason: HealthReason | null;
  /**
   * T29. The columns that have stopped moving, when `status` is FROZEN — or
   * when a higher-precedence fault outranks it but the instruments are still
   * stuck. T27: "a frozen tag makes its own drift figure a measurement of
   * nothing, so Alert leads while the per-tag badge stays." Empty otherwise.
   */
  frozenColumns: string[];
}

/**
 * `InferenceSchedule`'s own field names (schema.prisma, T09 Pass B) to
 * `prediction-drift.ts`'s `DriftThresholds` shape — the one place this
 * rename happens, so a caller never has to remember that `driftThresholdPct`
 * IS `outOfRangePct` under a different name chosen for the settings UI.
 */
export function thresholdsFromSchedule(schedule: {
  warnSd: number;
  criticalSd: number;
  driftThresholdPct: number;
}): DriftThresholds {
  return {
    warnSd: schedule.warnSd,
    criticalSd: schedule.criticalSd,
    outOfRangePct: schedule.driftThresholdPct,
  };
}

/**
 * `driftMonitor` gates the axis entirely — OFF is not a severity, it is
 * "not configured to look," matching this field's own documented purpose
 * (schema.prisma, T09 Pass B) rather than silently defaulting to a
 * status the operator never asked to see. `driftStatus === null` covers
 * every reason there is nothing to classify YET (no PRODUCTION version, no
 * windows with usable stats) without the caller having to distinguish
 * those reasons here — UNKNOWN is the same "nothing to report" word
 * `computeDrift` itself already uses for a column with no baseline.
 */
/**
 * MODEL-SERVE-001-T26 widened this. THE HALF THAT MUST NOT BE SPLIT OFF:
 * T26 makes Deploy = Running STICKY, so staleness and fetch faults stop
 * reaching the deploy axis. Before this change, staleness -> deploy 'error'
 * was THE ONLY SIGNAL that the monitoring record had stopped being written.
 * If Running became sticky and staleness were not re-homed in the same pass,
 * both axes would read healthy while the scheduler was dead — strictly worse
 * than what it replaced. MODEL-SERVE-006-T10 is labelled "DO NOT CUT THIS
 * TASK" in its own words: "A drift dashboard with no incoming data looks
 * calm, and calm is exactly the wrong signal."
 *
 * WHY FAULTS ARE NOT GATED BEHIND `driftMonitor`, THOUGH DRIFT IS. This is
 * the one judgement call in the task, so it is written down rather than left
 * in the control flow. `driftMonitor` defaults to FALSE. Gating liveness
 * behind it would mean every schedule that never opted into drift watching
 * reads OFF forever — reinstating the exact calm-dashboard blindness above,
 * for the majority of models. `driftMonitor` governs whether this system
 * WATCHES FOR DRIFT; it was never a claim about whether the schedule's own
 * windows are arriving. So: an ENABLED schedule always reports its fetch
 * faults and its staleness; only the DRIFT verdict is gated.
 *
 * `OFF` therefore keeps its single meaning — DELIBERATELY NOT WATCHING: the
 * schedule is disabled, or drift watching is off and there is no fault to
 * report. Staleness is never routed to OFF. Collapsing "the operator turned
 * it off" with "the record died" into one value is precisely the
 * one-control-two-facts defect T19 Part B had to close when the Start/Stop
 * toggle was bound to a derived value. Rejected alternative, recorded on T26:
 * Monitoring = Offline for staleness (dresses a fault as an intention).
 */
export function classifyModelHealth(input: {
  /** The schedule's own `enabled` flag. A disabled schedule has no liveness
   *  to assess — its windows are SUPPOSED to have stopped. */
  enabled: boolean;
  driftMonitor: boolean;
  driftStatus: DriftStatus | null;
  /**
   * How many of the most recent terminal windows, counted back from the
   * newest, are FAILED. Three is the bar, matching the sample
   * `deriveDeployStatuses` already takes and the `failing` rule this signal
   * inherited from the deploy axis — not a new threshold, and deliberately
   * not one of T28's configurable ones.
   */
  consecutiveFailures: number;
  /** `isStale`'s verdict (lib/deploy-status.ts). T11 extracted that function
   *  precisely so a third copy of the formula would not appear; this is its
   *  new home, not a reimplementation. */
  staleness: 'OK' | 'STALE';
  /**
   * Has this schedule EVER produced a SUCCEEDED/SKIPPED window? Required
   * because `isStale(null, ...)` returns STALE by its own documented
   * refusal-direction rule, so without this a schedule enabled ten seconds
   * ago — which has produced nothing yet BY CONSTRUCTION — would alarm
   * immediately on every single fresh enable. "Never produced anything" is a
   * warm-up, not a dead record.
   */
  hasEverSucceeded: boolean;
  /**
   * T27/T28. A CONSECUTIVE RUN of SKIPPED windows counted back from the
   * newest, against `skipStreakAlert`. A COUNT would be the wrong input:
   * T01/T10/T11 each hold that SKIPPED is a legitimate terminal status for a
   * quiet plant and must neither raise nor suppress the alarm, so a total of
   * them says nothing while a RUN of them says predictions have stopped.
   */
  consecutiveSkips: number;
  skipStreakAlert: number;
  /**
   * T05's own `missingPct` on the NEWEST terminal window — Bad CELLS, not
   * missing tags (structural absence is T25's preflight). Newest rather than
   * a rollup because the question is "is the data bad RIGHT NOW"; a rollup
   * answers a different one and disagrees on a plant that just recovered.
   * Null when no terminal window carries it.
   */
  missingPct: number | null;
  missingPctWarn: number;
  missingPctAlert: number;
  /** T29's verdict. Non-empty means at least one instrument has stopped
   *  moving. */
  frozenColumns: string[];
  /**
   * T27 RULE (2), THE DARK-SHIP GATE, AS A REQUIRED INPUT RATHER THAN AN
   * ASSUMPTION. False when there is no evidence to judge drift on: an EMPTY
   * baseline, or no window carrying featureStats. Both of those reach this
   * module as a perfectly ordinary "no columns" drift report whose status is
   * UNKNOWN — and `resolveColumnBaseline` returns `{}` from its SUCCESS path
   * as well as its catch path, so the two are indistinguishable downstream.
   * Without this flag a model whose column_stats read failed would report
   * healthy. T17 confirmed live that today's specs carry no psiRefEdges at
   * all, so this is the live case, not a hypothetical.
   */
  driftEvidence: boolean;
}): ModelHealth {
  const frozenColumns = input.frozenColumns;
  const off = (reason: HealthReason | null = null): ModelHealth => ({
    status: 'OFF',
    reason,
    frozenColumns,
  });

  // PRECEDENCE, T27's own list: Offline > Alert > Sensor Frozen > Warning >
  // Normal. Note `frozenColumns` rides EVERY return, not just the FROZEN one
  // — a higher-precedence fault outranks the frozen BAND without making the
  // stuck instruments stop being stuck, and the per-tag badge still needs
  // them.
  if (!input.enabled) return off();

  // ── Alert ────────────────────────────────────────────────────────────────
  // Faults first: a source that is not answering makes every drift number
  // downstream of it meaningless, so reporting drift over the top of it would
  // be answering a question nobody can trust the inputs of.
  if (input.consecutiveFailures >= 3) {
    return { status: 'ALERT', reason: 'SOURCE_UNREACHABLE', frozenColumns };
  }
  // STALE means "the record STOPPED being written", which presupposes it ever
  // started. A schedule that has produced nothing yet is warming up — the
  // deploy axis already says so with `initializing`, and alarming here would
  // fire on every fresh enable.
  //
  // RESIDUAL GAP, DECLARED RATHER THAN HIDDEN: a schedule that passes
  // preflight and then never produces a single window reads UNKNOWN here
  // forever, not ALERT. Closing that needs a clock this function does not
  // have (how long since the schedule was enabled, against how many cadences)
  // — that is T28's stale-cadence threshold, the one field of its six this
  // pass deliberately did not build. Do not fix it here with a second,
  // inline guess.
  if (input.staleness === 'STALE' && input.hasEverSucceeded) {
    return { status: 'ALERT', reason: 'STALE', frozenColumns };
  }
  // A RUN of SKIPPED windows, never a count — see `consecutiveSkips`. The
  // alarm is that predictions have stopped arriving, which a quiet plant's
  // occasional SKIPPED does not mean.
  if (
    input.skipStreakAlert > 0 &&
    input.consecutiveSkips >= input.skipStreakAlert
  ) {
    return { status: 'ALERT', reason: 'NO_PREDICTIONS', frozenColumns };
  }
  if (input.missingPct !== null && input.missingPct >= input.missingPctAlert) {
    return { status: 'ALERT', reason: 'BAD_DATA', frozenColumns };
  }
  // DRIFT_CRITICAL is an ALERT with its own reason rather than a bare
  // 'CRITICAL' status, because T27 requires the card to name WHICH metric
  // fired: z-score is per-window and PSI is rolling-24, so one merged drift
  // figure would be one metric wearing another's name. Gated on
  // `driftEvidence` — see that field's own doc.
  if (input.driftMonitor && input.driftEvidence) {
    if (input.driftStatus === 'CRITICAL') {
      return { status: 'ALERT', reason: 'DRIFT_CRITICAL', frozenColumns };
    }
  }

  // ── Sensor Frozen ────────────────────────────────────────────────────────
  // Below Alert, above Warning: a stuck instrument is a real fault, but a
  // source that is down or a record that has stopped is a bigger one.
  if (frozenColumns.length > 0) {
    return { status: 'FROZEN', reason: 'SENSOR_FROZEN', frozenColumns };
  }

  // ── Warning ──────────────────────────────────────────────────────────────
  if (input.missingPct !== null && input.missingPct >= input.missingPctWarn) {
    return { status: 'WARN', reason: 'BAD_DATA', frozenColumns };
  }
  if (
    input.driftMonitor &&
    input.driftEvidence &&
    input.driftStatus === 'WARN'
  ) {
    return { status: 'WARN', reason: 'DRIFT_WARN', frozenColumns };
  }

  // ── Normal / nothing to say ──────────────────────────────────────────────
  // Drift watching off: no drift CLAIM is made either way. Liveness above
  // already ran, unconditionally, which is the T26 decision this preserves.
  if (!input.driftMonitor) return off();
  // T27 RULE (2). No evidence is NOT health. An empty baseline or a window
  // set with no featureStats lands here as UNKNOWN, never OK — that is the
  // whole difference between this and a dashboard that ships dark.
  if (!input.driftEvidence) {
    return { status: 'UNKNOWN', reason: null, frozenColumns };
  }
  if (input.driftStatus === null) {
    return { status: 'UNKNOWN', reason: null, frozenColumns };
  }
  // `computeDrift`'s own UNKNOWN (no column had a usable baseline) must not
  // become OK either — it passes through as itself.
  if (input.driftStatus === 'UNKNOWN') {
    return { status: 'UNKNOWN', reason: null, frozenColumns };
  }
  return { status: 'OK', reason: null, frozenColumns };
}
