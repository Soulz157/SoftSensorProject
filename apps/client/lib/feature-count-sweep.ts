/**
 * MODEL-FLOW-019-T31. The feature-count sweep, as pure derivations.
 *
 * The user asked for a table of Number-of-X against RMSE and R², so a reader
 * can see how many features is best. This module answers that as a CURVE WITH
 * INTERVALS and a STATED RULE, never as a bolded argmin — and the reference
 * table that prompted the request is itself the argument for why.
 *
 * In that table n=7 read 0.0522 and n=4 read 0.0526, a difference of 0.8
 * percent, while n=6 (0.0554) was WORSE than n=5 (0.0550). The ordering
 * already contradicts itself inside seven rows, at effective sample sizes
 * where that gap cannot be distinguished from zero. A bolded minimum of seven
 * draws is not a finding. MODEL-FLOW-020-T03 is the precedent and it is
 * exact: a real capacity ladder over three effective sample sizes produced
 * THREE DIFFERENT ORDERINGS of the same five settings and closed as a
 * measured no-op.
 *
 * No fetching here — data belongs to hooks, derivations belong to lib
 * (CLAUDE.md). Every function below is total and free of side effects.
 */

import { observationsPerFeature, rankFeatures } from '@/lib/feature-importance'
import { sourcedMetricsOf } from '@/lib/metric-source'
import type {
  ModelTrainingRunListItem,
  RunFeatureImportance,
} from '@/services/model-draft'

/** The counts a sweep walks, matching the user's own reference table. */
export const DEFAULT_SWEEP_COUNTS = [1, 2, 3, 4, 5, 6, 7] as const

/** One planned row: how many features, and which ones. */
export interface SweepPlanRow {
  n: number
  features: string[]
}

/**
 * ONE ranking, applied to every row — forced, not preferred.
 *
 * MODEL-FLOW-019-T09 records no importance at all for mlp, grp, hgb, a
 * non-linear svm, lstm and gru, so a per-model ranking cannot exist for most
 * of the algorithm catalogue. A table whose row n=4 meant a DIFFERENT four
 * features per model would not be a comparison at all. So the order is
 * computed ONCE, from a seed run that has importance, and the same prefix is
 * used for every row.
 *
 * TOP-K PREFIX IS A GREEDY FILTER, NOT THE BEST K-SUBSET, and the distinction
 * is not pedantry: the best 4 of 21 need not be the top 4 of a ranking built
 * on all 21. Exhaustive search is not the alternative — at 21 features that
 * is over two million subsets against 32 to 97 distinct labelled values, and
 * the argmin of two million draws on 32 points is noise with a decimal point.
 * The prefix is chosen BECAUSE it does not search, which is what keeps the
 * sweep interpretable.
 *
 * Counts above the feature set's own size are dropped rather than clamped —
 * two rows both meaning "all 21 features" would put a duplicate point on the
 * curve and invite reading the gap between them as signal.
 */
export function prefixesFromSeed(
  seed: RunFeatureImportance,
  counts: readonly number[] = DEFAULT_SWEEP_COUNTS,
): SweepPlanRow[] {
  const ordered = rankFeatures(seed, seed.features.length).map(f => f.name)
  const seen = new Set<number>()
  const rows: SweepPlanRow[] = []
  for (const n of [...counts].sort((a, b) => a - b)) {
    if (n < 1 || n > ordered.length || seen.has(n)) continue
    seen.add(n)
    rows.push({ n, features: ordered.slice(0, n) })
  }
  return rows
}

/** One row as rendered: its own estimate, its own spread, its own arithmetic. */
export interface SweepRow {
  runId: string
  status: ModelTrainingRunListItem['status']
  /**
   * What the run ACTUALLY trained on, read from its own recorded
   * `metrics.feature_count` — the trainer's count of the columns it fit,
   * never the `featureColumns` request echoed back. The two agree or the run
   * failed (the container refuses a column the artifact lacks), and reading
   * the record rather than the request is what makes that guarantee visible.
   */
  n: number | null
  features: string[]
  /** Fold mean and spread. `std` null => this row makes NO ordering claim. */
  rmse: { mean: number | null; std: number | null }
  r2: { mean: number | null; std: number | null }
  obsPerFeature: number | null
}

function featureCountOf(run: ModelTrainingRunListItem): number | null {
  const metrics = run.metrics as Record<string, unknown> | null | undefined
  const value = metrics?.['feature_count']
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * The rows of one sweep, ascending by feature count.
 *
 * Metrics come from `sourcedMetricsOf`, never re-derived here: a sweep row is
 * a CV run, so its figures arrive as a `cv-fold-estimate` carrying mean AND
 * std, which is how every row gets the interval AC67 requires without any
 * repeated-seed scheme. A row still running, or one that failed, is KEPT with
 * null figures rather than filtered away — a sweep whose n=6 row has not
 * landed yet is a different reading of the curve from one that never had an
 * n=6 row, and only the first is recoverable by waiting.
 */
export function buildSweepRows(
  runs: ModelTrainingRunListItem[],
  distinctLabelledValues: number | null,
): SweepRow[] {
  return runs
    .map(run => {
      const cv = sourcedMetricsOf(run).find(
        m => m.source === 'cv-fold-estimate',
      )
      const n = featureCountOf(run)
      return {
        runId: run.id,
        status: run.status,
        n,
        features: run.featureColumns ?? [],
        rmse: { mean: cv?.mean.rmse ?? null, std: cv?.std.rmse ?? null },
        r2: { mean: cv?.mean.r2 ?? null, std: cv?.std.r2 ?? null },
        // AC68: the denominator is DISTINCT LABELLED VALUES, not row count —
        // y is a lab sample forward-filled across the frame, so the real
        // effective sample size is 32 to 97 on this system's own data. At
        // n_eff=32 a 7-feature row is 4.6 observations per feature, the
        // column that tells a reader the top row is interpolating rather
        // than generalising. Arithmetic only, never a recommended band.
        obsPerFeature: observationsPerFeature(distinctLabelledValues, n),
      }
    })
    .sort((a, b) => (a.n ?? Infinity) - (b.n ?? Infinity))
}

export interface SweepSelection {
  /** The row the RULE picks, or null when nothing can be ordered. */
  chosenRunId: string | null
  chosenN: number | null
  /** The lowest fold-mean RMSE — shown for transparency, never the answer. */
  bestRunId: string | null
  bestN: number | null
}

/** A row can be ordered only when it has BOTH a mean and a spread. */
function comparable(
  row: SweepRow,
): row is SweepRow & { rmse: { mean: number; std: number } } {
  return row.rmse.mean !== null && row.rmse.std !== null
}

/**
 * THE DELIVERABLE: the smallest n whose interval overlaps the best row's.
 *
 * This is the standard one-standard-error practice, and it is what makes the
 * table actionable at these sample sizes. On the user's own reference figures
 * it would very likely select 4 rather than 7, on the grounds that 7 buys
 * nothing measurable and costs three more parameters. The RULE is the
 * deliverable; the winner is an output of it.
 *
 * A row with no interval is not placed at all (V42) — it cannot be shown to
 * overlap or fail to overlap anything, and placing it by its mean alone would
 * be the argmin this whole module exists to refuse, arriving through a gap in
 * the data instead of through a decision.
 */
export function selectByOverlap(rows: SweepRow[]): SweepSelection {
  const usable = rows.filter(comparable)
  if (usable.length === 0) {
    return { chosenRunId: null, chosenN: null, bestRunId: null, bestN: null }
  }

  const best = usable.reduce((a, b) => (b.rmse.mean < a.rmse.mean ? b : a))
  const bestHigh = best.rmse.mean + best.rmse.std
  const bestLow = best.rmse.mean - best.rmse.std

  const overlapping = usable
    .filter(row => {
      const low = row.rmse.mean - row.rmse.std
      const high = row.rmse.mean + row.rmse.std
      return low <= bestHigh && bestLow <= high
    })
    .sort((a, b) => (a.n ?? Infinity) - (b.n ?? Infinity))

  const chosen = overlapping[0] ?? best
  return {
    chosenRunId: chosen.runId,
    chosenN: chosen.n,
    bestRunId: best.runId,
    bestN: best.n,
  }
}

/**
 * k = floor(distinct / MIN_LABELS_PER_FOLD), bounded to the 2-10 the run DTO
 * and the trainer both accept. `null` where no k is admissible.
 *
 * Moved here from the sweep launcher when that panel was withdrawn: it is a
 * pure derivation and belongs in lib by this repo's own rule, which is where
 * it should have been written in the first place.
 *
 * This mirrors `assert_admissible_fold_count` EXACTLY
 * (images/trainer/app/splits.py): `max_admissible_k = distinct_labelled_values
 * // MIN_LABELS_PER_FOLD`, refusing when `n_splits > max_admissible_k`. So the
 * maximum admissible k is what this returns, and k=3 at 32 distinct values
 * passes that assertion rather than tripping it.
 *
 * Note the divisor is the TOTAL DISTINCT count over MIN_LABELS_PER_FOLD — not
 * the `k + 1` partition count `expanding_fold_plan` uses to size each fold's
 * test window. The two are different arithmetic on the same k, and reading the
 * second as the admissibility rule would refuse ladders the trainer accepts.
 *
 * The effective sample size is the DISTINCT labelled count and never the row
 * count, because the target is a lab sample carried across the frame.
 */
export function admissibleFolds(
  distinctLabelledValues: number | null,
): number | null {
  if (distinctLabelledValues === null) return null
  const k = Math.floor(distinctLabelledValues / 10)
  if (k < 2) return null
  return Math.min(k, 10)
}

/** AC67: the rule is PRINTED beside the table, never implied by a bold row. */
export function sweepRuleText(): string {
  return (
    'Selected by rule, not by the lowest number: the smallest feature count ' +
    'whose fold spread overlaps that of the best-scoring row. Where two rows ' +
    'overlap, the extra features bought nothing this data can measure.'
  )
}

/**
 * AC66 + AC69 in one paragraph, built from data rather than written into JSX.
 *
 * AC66 wants the seed run and its method named, and the ranking called
 * provisional under that method's own bias. AC69 wants the population stated
 * along with what it was already used to choose — and the honest answer
 * includes a second-order exposure worth recording rather than hiding: the
 * seed run's own hyperparameters were themselves chosen against test-split
 * RMSE (`advanceJobForRun` compares `run.metrics`, MODEL-FLOW-019-T01 finding
 * (b)), so the ranking inherits a faint trace of that selection.
 */
export function sweepProvenanceText(
  seedRunId: string,
  method: string,
  methodLabel: string,
): string {
  const bias =
    method === 'impurity'
      ? 'Impurity importance inflates with cardinality, so this order follows ' +
        'resolution as much as predictive value.'
      : 'A coefficient sees no interaction between features, so this order ' +
        'reads each one in isolation.'
  return (
    `Every row scores on its own cross-validation folds, and all rows share ` +
    `one ranking — taken from run ${seedRunId.slice(0, 8)} and measured by ` +
    `${methodLabel}. ${bias} That ranking is provisional under its own ` +
    `method: re-running it on a permutation seed is expected to reorder rows. ` +
    `The seed's own hyperparameters were chosen against its test-split score, ` +
    `so this order is not independent of the data it ranks.`
  )
}
