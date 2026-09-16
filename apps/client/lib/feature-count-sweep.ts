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
import { RANK_DIRECTION } from '@/lib/metric-ranking'
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
 * MODEL-FLOW-019-T09 records no importance at all for mlp, grp, hgb and a
 * non-linear svm — CORRECTED for lstm/gru, which MODEL-FLOW-023-T10 gave a
 * permutation ranking; the sweep launcher does not consume it yet (a
 * separate feature, not built here), so those two still cannot seed a row
 * through THIS module today. A per-model ranking still cannot exist for
 * most of the algorithm catalogue. A table whose row n=4 meant a DIFFERENT
 * four features per model would not be a comparison at all. So the order is
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

/**
 * MODEL-FLOW-019-T35. WHICH FIGURE DECIDES WHICH ROW WINS.
 *
 * T31 fixed this at RMSE for a stated reason, but read what the reason
 * actually rules on: "cv_r2_mean is an average of ratios with a different
 * denominator per fold, so ONE quiet fold can drag it without limit". That
 * argument rules R2 OUT. It never once ruled RMSE IN over MAE — which is the
 * whole of what this union reopens.
 *
 * R2 IS DELIBERATELY NOT A MEMBER. It stays a rendered COLUMN and is refused
 * as the decider — the same admissible-in-one-role, refused-in-another split
 * AC34 already settled for R2 as a ratio operand. Expressing the refusal in
 * the TYPE means a caller cannot pass it rather than merely being told not
 * to, and `sweepRuleText` states it where the reader deciding is looking.
 *
 * THIS IS NOT THE TRAINING OBJECTIVE AND MUST NEVER BE DESCRIBED AS ONE.
 * `lossFunction` never reaches the trainer at all — LOSS_OPTIONS' own doc
 * comment records MODEL-FLOW-012's audit (train.py reads no loss/objective/
 * criterion anywhere, and CreateTrainingRunSchema is `.strict()`) — and
 * `launchFeatureCountSweep` omits it besides, so every row of a sweep trains
 * on the same defaults. This is therefore the metric a reader CHOOSES TO
 * READ RESULTS BY, and the copy says exactly that. A control claiming the
 * estimator was "fit for" the chosen metric would be false for every row of
 * every sweep, on every algorithm.
 *
 * Members stay SEPARATE even where copy collapses them (T29's precedent).
 */
export type SweepMetric = 'rmse' | 'mae'

/** What a sweep launched before T35 is read as, and what a new one starts on.
 *  Unchanged behaviour for an existing sweep — but NAMED now rather than
 *  implied, which is the whole point of recording it. */
export const DEFAULT_SWEEP_METRIC: SweepMetric = 'rmse'

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
  /** MODEL-FLOW-019-T35. Carried for EVERY row whether or not it decides —
   *  the column renders wherever there is data, and a reader comparing the
   *  two ladders needs both present at once. */
  mae: { mean: number | null; std: number | null }
  r2: { mean: number | null; std: number | null }
  obsPerFeature: number | null
}

/** The one pair `selectByOverlap` orders on, for the metric in force. Kept as
 *  an accessor rather than a `row[metric]` index at each call site so the
 *  decidable metrics stay exactly the `SweepMetric` union — indexing would
 *  silently admit `r2` the moment someone widened the key type. */
function statFor(row: SweepRow, metric: SweepMetric) {
  return metric === 'mae' ? row.mae : row.rmse
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
        // MODEL-FLOW-019-T35. Each metric reads its OWN fold mean and spread
        // — `CvFoldEstimate` carries named `MetricTriple` pairs, so this is a
        // widening rather than a re-derivation (MODEL-FLOW-019-T36 audited
        // the accessor and confirmed no metric can answer with another's
        // number). All six figures exist on every CV run this system has ever
        // trained (cv_{r2,mae,rmse}_{mean,std}, pipelines/cv_expanding.py),
        // so there is no legacy null to design around.
        mae: { mean: cv?.mean.mae ?? null, std: cv?.std.mae ?? null },
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

export function seedMetricMeans(
  seedRun: Parameters<typeof sourcedMetricsOf>[0],
): { rmse: number | null; mae: number | null } {
  const cv = sourcedMetricsOf(seedRun).find(
    m => m.source === 'cv-fold-estimate',
  )
  return { rmse: cv?.mean.rmse ?? null, mae: cv?.mean.mae ?? null }
}

export interface SweepSelection {
  /** The row the RULE picks, or null when nothing can be ordered. */
  chosenRunId: string | null
  chosenN: number | null
  /** The best fold mean under the metric in force — shown for transparency,
   *  never the answer. "Best" rather than "lowest": `RANK_DIRECTION` decides
   *  the sense, and nothing here assumes smaller wins. */
  bestRunId: string | null
  bestN: number | null
}

/** A row that CAN be ordered, with its pair already resolved to numbers. */
interface OrderableRow {
  row: SweepRow
  mean: number
  std: number
}

/**
 * The rows orderable on the metric IN FORCE, each carrying its resolved pair.
 *
 * A row needs BOTH a mean and a spread for THAT metric: one carrying RMSE but
 * no MAE is unorderable on a MAE ladder and is refused there, exactly as V42
 * requires — never quietly placed by whichever metric it happens to have.
 *
 * Resolving the pair HERE, once, is what keeps the rest of this module free of
 * non-null assertions: a filter returning `SweepRow[]` would leave every later
 * read nullable and invite `as number` at four sites, which CLAUDE.md's type
 * rule forbids and which the pre-T35 type guard did not need either.
 */
function orderableRows(rows: SweepRow[], metric: SweepMetric): OrderableRow[] {
  return rows.flatMap(row => {
    const { mean, std } = statFor(row, metric)
    return mean !== null && std !== null ? [{ row, mean, std }] : []
  })
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
export function selectByOverlap(
  rows: SweepRow[],
  metric: SweepMetric = DEFAULT_SWEEP_METRIC,
): SweepSelection {
  const usable = orderableRows(rows, metric)
  if (usable.length === 0) {
    return { chosenRunId: null, chosenN: null, bestRunId: null, bestN: null }
  }

  // DIRECTION IS READ, NEVER PASSED AND NEVER COPIED. `RANK_DIRECTION` is the
  // one table in this codebase that answers min-or-max per metric — built by
  // T03, reused by T07's comparatorSymbol, read directly by isRankMetricKey
  // after T10 replaced a maintained exclusion list with it. A direction
  // parameter here would let a caller order MAE ascending on one screen and
  // descending on another; a second copy would drift from the first.
  const direction = RANK_DIRECTION[metric]
  const better = (a: number, b: number) => (direction === 'min' ? b < a : b > a)

  const best = usable.reduce((a, b) => (better(a.mean, b.mean) ? b : a))
  const bestHigh = best.mean + best.std
  const bestLow = best.mean - best.std

  const overlapping = usable
    .filter(({ mean, std }) => mean - std <= bestHigh && bestLow <= mean + std)
    .sort((a, b) => (a.row.n ?? Infinity) - (b.row.n ?? Infinity))

  const chosen = overlapping[0] ?? best
  return {
    chosenRunId: chosen.row.runId,
    chosenN: chosen.row.n,
    bestRunId: best.row.runId,
    bestN: best.row.n,
  }
}

export function selectByBestMean(
  rows: SweepRow[],
  metric: SweepMetric = DEFAULT_SWEEP_METRIC,
): SweepSelection {
  const usable = rows.flatMap(row => {
    const { mean } = statFor(row, metric)
    return mean !== null ? [{ row, mean }] : []
  })
  if (usable.length === 0) {
    return { chosenRunId: null, chosenN: null, bestRunId: null, bestN: null }
  }

  const direction = RANK_DIRECTION[metric]
  const better = (a: number, b: number) => (direction === 'min' ? b < a : b > a)
  const best = usable.reduce((a, b) => (better(a.mean, b.mean) ? b : a))

  return {
    chosenRunId: best.row.runId,
    chosenN: best.row.n,
    bestRunId: best.row.runId,
    bestN: best.row.n,
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

/** Display spelling per decidable metric. Deliberately not imported from
 *  metric-ranking's own private `METRIC_LABELS` — that one is not exported,
 *  and this module already keeps its display vocabulary beside its rules. */
const SWEEP_METRIC_LABELS: Record<SweepMetric, string> = {
  rmse: 'RMSE',
  mae: 'MAE',
}

export function sweepMetricLabel(metric: SweepMetric): string {
  return SWEEP_METRIC_LABELS[metric]
}

/**
 * AC67: the rule is PRINTED beside the table, never implied by a bold row.
 *
 * MODEL-FLOW-019-T35 EXTENDS AC67 rather than amending it — that criterion
 * names no metric, and a rule stated without one is only half printed. So
 * this now names the metric AND its direction, with the same discipline that
 * made T31 print the seed run id and the seed method rather than let the
 * ranking appear to come from nowhere.
 *
 * THE SELECTED n CHANGES WITH THE METRIC, AND THAT IS THE FEATURE — but it
 * reads as a bug unless said out loud. MAE's fold-to-fold spread is narrower
 * than RMSE's (RMSE is dominated by tail residuals), so narrower intervals
 * overlap the best row less often and the rule selects a row CLOSER to the
 * argmin — frequently a LARGER n than the same ladder decided on RMSE.
 *
 * The R2 refusal lives HERE, next to the rule a reader is consulting to
 * decide, rather than parked in a metadata table they would have to go
 * looking for.
 */
export function sweepRuleText(
  metric: SweepMetric = DEFAULT_SWEEP_METRIC,
): string {
  const label = SWEEP_METRIC_LABELS[metric]
  const sense = RANK_DIRECTION[metric] === 'min' ? 'lowest' : 'highest'
  return (
    `Decided on ${label} (${sense} is better). The highlighted row is the ` +
    `${sense} fold mean. At these fold counts the gap between adjacent rows ` +
    `is often smaller than their own spread, so read the ± beside each ` +
    `figure before treating the order as settled. R² is shown as a column ` +
    `but cannot decide the ladder — it is a fold average of ratios whose ` +
    `denominator changes per fold, so one quiet fold can move it without ` +
    `limit.`
  )
}

/**
 * What the metric control is and — as importantly — what it is not.
 *
 * Two misreadings are available to anyone who sees a metric control on this
 * screen, and both are stated away rather than left to inference:
 *
 * 1. THAT IT RE-RANKS STEP 4. It does not. `rankCandidates` and its
 *    source-preference order are untouched; this decides which ROW OF THIS
 *    LADDER wins and nothing else.
 * 2. THAT THE ROWS WERE FIT FOR IT. They were not, and no run in this system
 *    ever is — `lossFunction` never reaches the trainer (see `SweepMetric`).
 *    Every row here trains on identical defaults, which is exactly the
 *    property that makes the rows comparable to each other.
 */
export function sweepMetricScopeText(metric: SweepMetric): string {
  return (
    `${SWEEP_METRIC_LABELS[metric]} decides which row of this ladder wins. ` +
    `It does not re-rank candidates in Model Selection, and it is not a ` +
    `training objective — every row here trained on the same defaults, which ` +
    `is what makes them comparable. This is the figure you are choosing to ` +
    `read the result by.`
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
