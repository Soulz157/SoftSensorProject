/**
 * MODEL-FLOW-019-T03 — ordering a candidate set, with the ordering's own
 * source stated and every missing metric's fate defined.
 *
 * Pure module — no React, no IO (the `lib/run-selection.ts` pattern), and
 * generic over the row type so a caller can rank ONE phase group at a time
 * without this module ever learning what a phase is.
 *
 * THREE RULES THIS MODULE EXISTS TO ENFORCE:
 *
 * 1. NEVER SORT A MIXED COLUMN. A holdout figure and a test-split figure
 *    are different claims (a test split is scored on rows drawn from the
 *    same cleaned artifact the model trained on; the holdout is raw rows no
 *    fit ever saw). Ordering one against the other produces a list whose
 *    order means nothing. So the ordering runs on the source EVERY ranked
 *    row shares, or it does not run at all.
 * 2. SAY WHICH SOURCE ORDERED THE LIST. A ranked list is a claim about
 *    ordering, and that claim changes meaning entirely with the metric
 *    behind it — `orderingSource` is returned so a caller can state it for
 *    the ORDERING ITSELF, not only per cell.
 * 3. A MISSING METRIC HAS A STATED PLACE, NOT A DEFAULT ONE. Sorting nulls
 *    quietly to the bottom is a decision; this module makes it an explicit
 *    one — unranked rows stay in the result, after the ranked ones, in
 *    input order, each carrying WHY it could not be ranked. They are never
 *    dropped, the rule MODEL-FLOW-013-T07 already established for FAILED
 *    candidates.
 *
 * WHAT THIS MODULE DOES NOT TOUCH: `bestRunId`. That is the metric's own
 * answer, computed server-side off the test-split rmse in `advanceJobForRun`
 * and unchanged by anything here (MODEL-FLOW-019 AC8). This module orders a
 * DISPLAY; the two are deliberately different things, which is exactly why
 * the user's own override stays visible beside a ranked table.
 */
import {
  METRIC_SOURCE_LABELS,
  metricValueOf,
  type HoldoutAbsence,
  type MetricSource,
  type MetricTriple,
  type SourcedMetrics,
} from '@/lib/metric-source'

/** RMSE is the default and is MINIMISED. MODEL-FLOW-005 chose it over r2
 *  after a real observed run scored r2 = -1,110,858 while its rmse stayed a
 *  readable, comparable number; that reasoning is unchanged and this module
 *  does not reopen it — r2 stays rankable (maximised) for a caller that
 *  asks for it, rather than being refused. */
export type RankMetricKey = keyof MetricTriple

export const RANK_DIRECTION: Record<RankMetricKey, 'min' | 'max'> = {
  rmse: 'min',
  mae: 'min',
  r2: 'max',
}

export const DEFAULT_RANK_METRIC: RankMetricKey = 'rmse'

/**
 * Why a row carries no rank. Each is a different situation with a different
 * thing to say to the reader, which is why they are not one "no metric".
 *
 * - `no-run`         — this candidate never launched (status PENDING).
 * - `not-finished`   — QUEUED or RUNNING; it will have a figure later.
 * - `failed`         — FAILED or CANCELED; it never will.
 * - `missing-metric` — terminal and successful, but carries no value for
 *   this metric in the source the ordering ran on.
 * - `no-shared-source` — nothing could be ordered at all: the set has no
 *   single source every row carries, so ranking any of it would mean
 *   sorting a mixed column.
 */
export type UnrankedReason =
  | 'no-run'
  | 'not-finished'
  | 'failed'
  | 'missing-metric'
  | 'no-shared-source'

/**
 * Why the ordering is NOT on the holdout, when it is not. `no-dataset-holdout`
 * is an honest fallback — those datasets never had a holdout and never will
 * produce one. `holdout-not-recorded` is NOT: the dataset HAS a holdout and
 * some row still lacks its figure (a run older than the 2026-09-01 replay
 * fix, or a replay that failed), so the fallback is covering for a defect
 * and a caller must be able to say so rather than quietly ranking on the
 * test split. Loudest wins where a set mixes them.
 */
export type FallbackReason =
  | 'no-dataset-holdout'
  | 'holdout-not-scored-yet'
  | 'holdout-not-recorded'

/** What this module needs of a row. Structural, so a `CandidateResult`, a
 *  raw run row, or a test fixture all satisfy it without a cast. */
export interface RankableRow {
  status: string
  sourcedMetrics: SourcedMetrics[]
  holdoutAbsence?: HoldoutAbsence | null
}

export interface RankedEntry<T> {
  row: T
  /** 1-based, ties SHARING a rank (1, 1, 3 — competition style), or null
   *  when this row is not ranked. */
  rank: number | null
  /** The figure the ordering used for this row, with its own source still
   *  attached — never a bare number. Null when unranked. */
  metric: SourcedMetrics | null
  value: number | null
  unranked: UnrankedReason | null
}

export interface Ranking<T> {
  /** The source every ranked row shares, or null when nothing was ranked. */
  orderingSource: MetricSource | null
  /** Present only when the ordering is not on the holdout AND some row had
   *  a missing holdout figure to explain — see `FallbackReason`. */
  fallbackReason: FallbackReason | null
  metric: RankMetricKey
  /** Ranked rows best-first, then every unranked row in INPUT order. */
  entries: RankedEntry<T>[]
}

/** Preference order for the ordering's source: the shipped model's own
 *  holdout score first (the only figure no fit ever saw), the run's own
 *  test split next, a fold ESTIMATE last — an estimate of a configuration
 *  is the weakest claim of the three and is used only when it is all a set
 *  has. */
const SOURCE_PREFERENCE: MetricSource[] = [
  'holdout',
  'test-split',
  'cv-fold-estimate',
]

function statusUnrankedReason(status: string): UnrankedReason | null {
  if (status === 'PENDING') return 'no-run'
  if (status === 'QUEUED' || status === 'RUNNING') return 'not-finished'
  if (status === 'FAILED' || status === 'CANCELED') return 'failed'
  return null
}

function valueFor(
  row: RankableRow,
  source: MetricSource,
  metric: RankMetricKey,
): { metric: SourcedMetrics; value: number } | null {
  const found = row.sourcedMetrics.find(m => m.source === source)
  if (!found) return null
  const value = metricValueOf(found, metric)
  return value === null ? null : { metric: found, value }
}

/**
 * The loudest absence reason across rows that lack a holdout figure — a
 * real defect (`not-recorded`) outranks a pending action
 * (`not-scored-yet`), which outranks the honest "this dataset never had
 * one". Null when no row had anything to explain.
 */
function fallbackReasonOf(rows: RankableRow[]): FallbackReason | null {
  const absences = rows.map(r => r.holdoutAbsence ?? null)
  if (absences.includes('not-recorded')) return 'holdout-not-recorded'
  if (absences.includes('not-scored-yet')) return 'holdout-not-scored-yet'
  if (absences.includes('no-dataset-holdout')) return 'no-dataset-holdout'
  return null
}

/**
 * Order a candidate set on ONE source, stating which, and give every
 * unrankable row a reason instead of a silent position.
 *
 * The source is chosen by what the set SHARES: the holdout when every
 * rankable row carries a holdout figure for this metric, else the test
 * split, else a fold estimate. A set no single source covers is not ranked
 * at all — its rows come back in input order, each marked
 * `no-shared-source`, because sorting them would put two incomparable
 * numbers in one column and present the result as a ranking.
 */
export function rankCandidates<T extends RankableRow>(
  rows: T[],
  metric: RankMetricKey = DEFAULT_RANK_METRIC,
): Ranking<T> {
  const statusReasons = rows.map(r => statusUnrankedReason(r.status))
  const eligible = rows.filter((_, i) => statusReasons[i] === null)

  const orderingSource =
    SOURCE_PREFERENCE.find(
      source =>
        eligible.length > 0 &&
        eligible.every(row => valueFor(row, source, metric) !== null),
    ) ?? null

  const entries: RankedEntry<T>[] = rows.map((row, i) => {
    const statusReason = statusReasons[i] ?? null
    if (statusReason) {
      return {
        row,
        rank: null,
        metric: null,
        value: null,
        unranked: statusReason,
      }
    }
    if (!orderingSource) {
      return {
        row,
        rank: null,
        metric: null,
        value: null,
        unranked: 'no-shared-source',
      }
    }
    const hit = valueFor(row, orderingSource, metric)
    if (!hit) {
      // Unreachable while `orderingSource` is chosen by `every`, kept as an
      // honest branch rather than a non-null assertion: a future caller
      // supplying its own source lands here, and it must land on a reason
      // rather than on a crash or a silent zero.
      return {
        row,
        rank: null,
        metric: null,
        value: null,
        unranked: 'missing-metric',
      }
    }
    return {
      row,
      rank: null,
      metric: hit.metric,
      value: hit.value,
      unranked: null,
    }
  })

  const ranked = entries.filter(e => e.unranked === null)
  const direction = RANK_DIRECTION[metric]
  // Stable by construction: `entries` is in input order and Array#sort is
  // stable, so ties keep the order they arrived in.
  ranked.sort((a, b) =>
    direction === 'min'
      ? (a.value as number) - (b.value as number)
      : (b.value as number) - (a.value as number),
  )
  // Competition ranking — equal values SHARE a rank (1, 1, 3). Two models
  // that scored the same did not place differently, and numbering them 1
  // and 2 would assert a winner the metric never chose.
  let previousValue: number | null = null
  ranked.forEach((entry, i) => {
    entry.rank =
      previousValue !== null && entry.value === previousValue
        ? (ranked[i - 1]?.rank ?? i + 1)
        : i + 1
    previousValue = entry.value
  })

  return {
    orderingSource,
    // Null unless an ordering actually happened and ran on something other
    // than the holdout. With `orderingSource` null there is no fallback,
    // because there was no ordering to fall back FROM — reporting one there
    // would read as "ranked on the test split because of a defect" about a
    // set that was not ranked at all.
    fallbackReason:
      orderingSource === null || orderingSource === 'holdout'
        ? null
        : fallbackReasonOf(eligible),
    metric,
    entries: [...ranked, ...entries.filter(e => e.unranked !== null)],
  }
}

/** Human sentence for one metric key, matching `METRIC_META`'s own label
 *  casing without importing the whole evaluation-tile module for one word. */
const METRIC_LABELS: Record<RankMetricKey, string> = {
  rmse: 'RMSE',
  r2: 'R²',
  mae: 'MAE',
}

/**
 * The ONE sentence that states what a `Ranking` means — MODEL-FLOW-019 AC3's
 * "states which was used for the ordering", for the ordering itself, not
 * only per cell. A reader sees this once per table, above every row.
 */
export function rankingSummaryText<T>(ranking: Ranking<T>): string {
  const label = METRIC_LABELS[ranking.metric]
  if (ranking.orderingSource === null) {
    return 'Not ranked — no two rows here share a comparable score yet.'
  }
  const sourceWord = METRIC_SOURCE_LABELS[ranking.orderingSource]
  const base = `Ranked by ${sourceWord} ${label}`
  switch (ranking.fallbackReason) {
    case 'no-dataset-holdout':
      return `${base} — this dataset has no validation holdout.`
    case 'holdout-not-scored-yet':
      return `${base} — one or more holdout scores are still pending.`
    case 'holdout-not-recorded':
      return `${base} — one or more holdout scores are missing and should be present.`
    case null:
    default:
      return `${base}.`
  }
}
