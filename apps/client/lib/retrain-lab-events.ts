import type {
  EvalBasis,
  RetrainPredictionPopulation,
} from '@/services/model-retrain'
import type { MetricTriple } from '@/lib/retrain'

/**
 * MODEL-SERVE-026-T02 (rule: openDecision 2 as refined 2026-10-02). Which rows
 * of a target series are LAB EVENTS, as opposed to rows that merely repeat a
 * held value.
 *
 * Measured on the first real New Data Only job (eaa66ebf): a lab change shows
 * up as ONE blended row — an hourly summary straddling the change, e.g. 103.625
 * between 103.7 and 99.2 — followed by the new value held for hours. Counting
 * every value change counted each event twice (63 changes vs 32 plateaus on a
 * 744-row window). So:
 *  - a run of >= 2 identical consecutive values is one event, at its first row;
 *  - a one-row run strictly between its neighbours' values is a blend — skipped;
 *  - a one-row run that is not between them (a spike, or at either edge of the
 *    series, where there is no neighbour to judge by) is an event.
 * A lab value held for exactly one row is indistinguishable from a blend and
 * is skipped; the tab says so rather than claiming event detection.
 *
 * Values are compared at 4 decimals: the series is stored as float32, so a
 * held 103.7 arrives as 103.699997 and must still read as one plateau.
 */
export function labEventIndices(values: readonly number[]): number[] {
  const key = (v: number) => Math.round(v * 1e4)
  const runs: { start: number; length: number; value: number }[] = []
  for (const [i, value] of values.entries()) {
    const last = runs[runs.length - 1]
    if (last && key(last.value) === key(value)) last.length++
    else runs.push({ start: i, length: 1, value })
  }
  const events: number[] = []
  runs.forEach((run, r) => {
    if (run.length >= 2) {
      events.push(run.start)
      return
    }
    const prev = runs[r - 1]
    const next = runs[r + 1]
    const isBlend =
      prev !== undefined &&
      next !== undefined &&
      Math.min(prev.value, next.value) < run.value &&
      run.value < Math.max(prev.value, next.value)
    if (!isBlend) events.push(run.start)
  })
  return events
}

/**
 * MODEL-SERVE-026-T03. RMSE / MAE / R² over a set of rows. Unlike
 * `computeMetrics` (lib/model-evaluation.ts), an undefined figure is `null`,
 * never 0: no rows -> all null; fewer than 2 rows or a target with no
 * variance -> R² null. A constant target scored "R² 0.00" on a real retrain
 * (job 1939ed3e, 4 rows, one value) — a number for a figure that has none.
 */
export function scoreRows(
  points: readonly { yTrue: number; yPred: number }[],
): MetricTriple {
  const n = points.length
  if (n === 0) return { rmse: null, mae: null, r2: null }
  let se = 0
  let ae = 0
  let sum = 0
  for (const p of points) {
    const e = p.yPred - p.yTrue
    se += e * e
    ae += Math.abs(e)
    sum += p.yTrue
  }
  const mean = sum / n
  let ssTot = 0
  for (const p of points) ssTot += (p.yTrue - mean) ** 2
  return {
    rmse: Math.sqrt(se / n),
    mae: ae / n,
    r2: n < 2 || ssTot === 0 ? null : 1 - se / ssTot,
  }
}

/**
 * MODEL-SERVE-026-T03 (openDecision 2: lab-event rows primary, all rows kept
 * and labelled). Both figures from ONE series, by ONE rule — the same call
 * scores the candidate and the current version, so the two can never be
 * measured differently. Today's all-row figure weights each lab value by how
 * long it was held; the event figure counts each measurement once.
 */
export function labEventMetrics(
  points: readonly { yTrue: number; yPred: number }[],
): {
  events: number
  rows: number
  atEvents: MetricTriple
  allRows: MetricTriple
  /** MODEL-SERVE-026-T07. Spreads at the same lab-event rows. */
  spreadsAtEvents: EventSpreads
} {
  const idx = labEventIndices(points.map(p => p.yTrue))
  const atEventRows = idx.flatMap(i => {
    const p = points[i]
    return p ? [p] : []
  })
  return {
    events: idx.length,
    rows: points.length,
    atEvents: scoreRows(atEventRows),
    allRows: scoreRows(points),
    spreadsAtEvents: eventSpreads(atEventRows),
  }
}

export interface EventSpreads {
  /** SD of the lab values themselves. */
  targetSd: number | null
  /** SD of this version's errors (y_pred − y_true). */
  residualSd: number | null
}

/**
 * MODEL-SERVE-026-T07. Population SD (divide by n), the SAME convention as
 * `scoreRows`' R² — so "RMSE < SD of lab values" holds exactly when R² > 0,
 * and RMSE >= error SD always (RMSE² = SD² + bias²). Null below 2 rows.
 */
export function eventSpreads(
  points: readonly { yTrue: number; yPred: number }[],
): EventSpreads {
  const n = points.length
  if (n < 2) return { targetSd: null, residualSd: null }
  const sd = (xs: number[]) => {
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length
    return Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / xs.length)
  }
  return {
    targetSd: sd(points.map(p => p.yTrue)),
    residualSd: sd(points.map(p => p.yPred - p.yTrue)),
  }
}

export interface PairedEvent {
  timestamp: string
  yTrue: number
  candidatePred: number
  currentPred: number
  candidateAbsError: number
  currentAbsError: number
  winner: 'candidate' | 'current' | 'tie'
}

export interface PairedEvents {
  events: PairedEvent[]
  candidateWins: number
  currentWins: number
  ties: number
  /** Lab events in the candidate series with no current-version row at the
   *  same timestamp (or a different y_true there) — reported, never dropped
   *  silently. */
  unmatched: number
}

/**
 * MODEL-SERVE-026-T04. The two versions' errors compared EVENT BY EVENT on
 * the shared window — never two aggregates differenced. Both predicted the
 * same rows, so each event's own difficulty cancels out; at the sample sizes
 * this system has, that pairing is the only thing with any power.
 *
 * Events are picked by the same rule as everywhere else (`labEventIndices`),
 * on the candidate series; the current version's row is matched by timestamp
 * and must carry the same y_true. The summary is a win count — readable at
 * n = 6 and assuming nothing about the error distribution. No interval is
 * produced: at this autocorrelation a resample of a handful of events is
 * either uselessly wide or falsely narrow.
 */
export function pairedEvents(
  candidate: readonly { timestamp: string; yTrue: number; yPred: number }[],
  current: readonly { timestamp: string; yTrue: number; yPred: number }[],
): PairedEvents {
  const byTime = new Map(current.map(p => [p.timestamp, p]))
  const key = (v: number) => Math.round(v * 1e4)
  const events: PairedEvent[] = []
  let unmatched = 0
  for (const i of labEventIndices(candidate.map(p => p.yTrue))) {
    const c = candidate[i]
    const o = c ? byTime.get(c.timestamp) : undefined
    if (!c || !o || key(o.yTrue) !== key(c.yTrue)) {
      unmatched++
      continue
    }
    const candidateAbsError = Math.abs(c.yPred - c.yTrue)
    const currentAbsError = Math.abs(o.yPred - c.yTrue)
    events.push({
      timestamp: c.timestamp,
      yTrue: c.yTrue,
      candidatePred: c.yPred,
      currentPred: o.yPred,
      candidateAbsError,
      currentAbsError,
      winner:
        key(candidateAbsError) === key(currentAbsError)
          ? 'tie'
          : candidateAbsError < currentAbsError
            ? 'candidate'
            : 'current',
    })
  }
  return {
    events,
    candidateWins: events.filter(e => e.winner === 'candidate').length,
    currentWins: events.filter(e => e.winner === 'current').length,
    ties: events.filter(e => e.winner === 'tie').length,
    unmatched,
  }
}

/** At or below this many events the per-event table IS the result, so it is
 *  shown open; above it, the table is one click away. */
export const SMALL_EVENT_COUNT = 15

/** MODEL-SERVE-026-T04. Both figures sit on the shared window only when BOTH
 *  bases are that window — the one population both versions were scored on. */
export function pairableOnSharedWindow(view: {
  candidateMetricsBasis: EvalBasis | null
  incumbentMetricsBasis: EvalBasis
}): boolean {
  return (
    view.candidateMetricsBasis?.frame === 'NEW_DATA_WINDOW' &&
    view.incumbentMetricsBasis.frame === 'NEW_DATA_WINDOW'
  )
}

export interface CvGapFold {
  fold: number
  rows: number
  /** Rows the current version was scored on — at or after its own cut. */
  scoredRows: number
  events: number
  newRmse: number | null
  currentRmse: number | null
  /** new − current RMSE at lab events; negative = the new version is closer. */
  delta: number | null
  usable: boolean
}

export interface CvGapSummary {
  folds: CvGapFold[]
  usableFolds: number
  newBetterFolds: number
  /** Smallest and largest delta over usable folds — the spread. Null below
   *  `MIN_SPREAD_FOLDS` usable folds: two or three points read like a
   *  measurement and are not one. */
  spread: { min: number; max: number } | null
}

/** Below this many usable folds no spread is stated. */
export const MIN_SPREAD_FOLDS = 3

/**
 * MODEL-SERVE-026-T05. The cross-validation of the GAP, fold by fold, by the
 * SAME rule as everything else on the tab: per fold, only rows the current
 * version was scored on (the trainer leaves rows before its cut null), lab
 * events picked by `labEventIndices`, both versions scored there by
 * `scoreRows`. A fold with fewer than 2 such events — or none after the
 * current version's cut — is kept in the list, marked unusable, and does not
 * count toward the spread.
 */
export function cvGapFolds(
  points: readonly {
    fold: number
    timestamp: string
    yTrue: number
    yPred: number
    yPredCurrent: number | null
  }[],
): CvGapSummary {
  const byFold = new Map<number, (typeof points)[number][]>()
  for (const p of points) {
    const list = byFold.get(p.fold) ?? []
    list.push(p)
    byFold.set(p.fold, list)
  }
  const folds: CvGapFold[] = [...byFold.entries()]
    .sort(([a], [b]) => a - b)
    .map(([fold, rows]) => {
      const scored = rows
        .filter(
          (p): p is typeof p & { yPredCurrent: number } =>
            p.yPredCurrent !== null,
        )
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      const idx = labEventIndices(scored.map(p => p.yTrue))
      const at = idx.flatMap(i => {
        const p = scored[i]
        return p ? [p] : []
      })
      const newRmse = scoreRows(at).rmse
      const currentRmse = scoreRows(
        at.map(p => ({ yTrue: p.yTrue, yPred: p.yPredCurrent })),
      ).rmse
      const usable = at.length >= 2 && newRmse !== null && currentRmse !== null
      return {
        fold,
        rows: rows.length,
        scoredRows: scored.length,
        events: at.length,
        newRmse,
        currentRmse,
        delta:
          newRmse !== null && currentRmse !== null
            ? newRmse - currentRmse
            : null,
        usable,
      }
    })
  const usable = folds.filter(f => f.usable && f.delta !== null)
  const deltas = usable.map(f => f.delta as number)
  return {
    folds,
    usableFolds: usable.length,
    newBetterFolds: deltas.filter(d => d < 0).length,
    spread:
      usable.length >= MIN_SPREAD_FOLDS
        ? { min: Math.min(...deltas), max: Math.max(...deltas) }
        : null,
  }
}

/** The minimal shape `primaryFigure`/`eventRmseDelta` read from the hook. */
export type LabEventReading =
  | { status: 'loading' }
  | { status: 'ready'; events: number; rows: number; atEvents: MetricTriple }
  | { status: 'unavailable'; reason: string }

/**
 * MODEL-SERVE-026-T03. Which number a metric cell leads with. The lab-event
 * figure when it is ready; while it loads, nothing (no flip from one figure to
 * another); when it cannot be read, the server's all-row figure — LABELLED as
 * all-row, so a fallback never passes for the primary figure.
 */
export function primaryFigure(
  reading: LabEventReading,
  key: keyof MetricTriple,
  allRows: number | null,
):
  | { basis: 'events'; value: number | null; events: number }
  | { basis: 'pending' }
  | { basis: 'all-rows'; value: number | null; reason: string } {
  if (reading.status === 'ready')
    return {
      basis: 'events',
      value: reading.atEvents[key],
      events: reading.events,
    }
  if (reading.status === 'loading') return { basis: 'pending' }
  return { basis: 'all-rows', value: allRows, reason: reading.reason }
}

/**
 * MODEL-SERVE-026-T03. Candidate RMSE minus current RMSE, both at lab events.
 * Null unless both are ready and the server already judged the two figures
 * comparable — this never manufactures a comparison the all-row path refused.
 */
export function eventRmseDelta(
  candidate: LabEventReading,
  incumbent: LabEventReading,
  comparable: boolean,
): number | null {
  if (!comparable) return null
  if (candidate.status !== 'ready' || incumbent.status !== 'ready') return null
  const c = candidate.atEvents.rmse
  const i = incumbent.atEvents.rmse
  return c === null || i === null ? null : c - i
}

/** Where a basis's per-row series lives, so its lab events can be counted. */
export type LabEventSource =
  | { kind: 'series'; runId: string; population: RetrainPredictionPopulation }
  | { kind: 'unavailable'; reason: string }

/**
 * Maps a figure's basis to the predictions file covering the same rows. Only
 * `y_true` is counted, so any run scored on those rows will do — the
 * candidate's own run carries the frozen slice and both new-data windows.
 * `role` matters only for the shared window: the current version's figure
 * there lives on the candidate run as `current_new_data_holdout`.
 */
export function labEventSource(
  basis: EvalBasis,
  role: 'candidate' | 'incumbent',
  ids: { candidateRunId: string | null; incumbentSourceRunId: string | null },
): LabEventSource {
  const { candidateRunId, incumbentSourceRunId } = ids
  const onCandidate = (
    population: RetrainPredictionPopulation,
  ): LabEventSource =>
    candidateRunId
      ? { kind: 'series', runId: candidateRunId, population }
      : { kind: 'unavailable', reason: 'no finished new version' }
  switch (basis.frame) {
    case 'INCUMBENT_TEST_SPLIT':
      return incumbentSourceRunId
        ? { kind: 'series', runId: incumbentSourceRunId, population: 'test' }
        : { kind: 'unavailable', reason: 'current version has no source run' }
    case 'MERGED_TEST_SPLIT':
      return onCandidate('test')
    case 'FROZEN_INCUMBENT_TEST':
      return onCandidate('holdout')
    case 'NEW_DATA_WINDOW':
      return onCandidate(
        role === 'incumbent' ? 'current_new_data_holdout' : 'new_data_holdout',
      )
  }
}
