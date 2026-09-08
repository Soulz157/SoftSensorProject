/**
 * MODEL-FLOW-019-T12 — advisory acceptance criteria, now a BARE COMPARISON
 * between two figures of the same run rather than a ratio with a typed
 * ceiling (T11's shape). REVERSES T11 on the user's own ground: no
 * threshold is derivable from this system's data (MODEL-FLOW-020-T03 ran a
 * real capacity ladder at three effective sample sizes and got THREE
 * DIFFERENT ORDERINGS of the same five settings), so no number should be
 * typed at all. A criterion is `{left, operator, right}` — free operator,
 * chosen operands, no value.
 *
 * Pure module — no React, no IO, same as `lib/metric-ranking.ts`/
 * `lib/metric-source.ts`.
 *
 * OFFERABLE PAIRS ARE DERIVED, NEVER HAND-LISTED (AC24/AC25/AC29). A
 * hand-written allow-list of "which pairs make sense" becomes a second
 * source of truth about which metric is which — the drift MODEL-FLOW-020
 * finding 5 names. `offerablePairs()` builds every operand this system can
 * name, forms every ordered pair, and keeps the ones that survive four
 * rules — the only place that knowledge lives.
 *
 * THE FOUR RULES, each tied to a stated fact rather than a preference:
 *
 * 1. Exactly one of {metric, source} may differ between the two operands.
 *    Neither differing compares an operand to itself; both differing
 *    compares two changes at once and the result answers no single
 *    question.
 * 2. Both operands pin a source, or neither does (AC29). `sd` has no
 *    source of its own to pin (openDecision 6: `lib/residual-sd.ts`
 *    establishes a scored CV run's SD is its holdout figure while a
 *    non-CV run's is its test split), so a pair including `sd` is
 *    reachable only in the run-resolved form — a pinned figure is never
 *    compared against one whose population depends on the run's own
 *    shape, which is exactly the conflation this feature exists to
 *    prevent, reachable through the operand pair instead of a column
 *    header.
 * 3. Both operands share a unit class (AC25). RMSE/MAE/SD are all in the
 *    target's own units; R² is dimensionless. Non-negativity no longer
 *    gates offerability — that gate existed for division, withdrawn with
 *    it (AC25/AC30) — which is what lets R² back in as a comparison
 *    operand even though it is inadmissible as a ratio.
 * 4. The metric pair is not one whose order is fixed by algebra, in
 *    EITHER direction (AC24). For any residual vector, MAE <= RMSE
 *    (power-mean inequality) and residual_SD <= RMSE (RMSE² = SD² +
 *    mean(residual)²). A bare comparison on either pair fires on every
 *    run that will ever exist in one direction and on none in the other
 *    — a warning with no information, AC15's own failure arriving through
 *    the operand pair instead of the comparator.
 *
 * These four rules yield exactly four pairs today: holdout RMSE vs test
 * RMSE, holdout MAE vs test MAE, holdout R² vs test R², and MAE vs SD
 * (run-resolved on both sides) — proven as a SET in the colocated test,
 * not sampled one pair at a time.
 *
 * CANONICAL FORM ON COMMIT (AC31/AC38). With the operator free, `A < B`
 * and `B > A` are the same criterion written two ways, and nothing stops a
 * user adding both — two rows that mark identically and cannot be told
 * apart. `canonicalise` fixes the operand order by a stable key and
 * expresses the operator in that frame; `criterionEqual` compares
 * canonicalised criteria, so an already-added filter built on it actually
 * excludes the mirror. This hazard is NEW here — T11's pairs were
 * pre-oriented by `KNOWN_INEQUALITIES` and no mirror could be constructed.
 *
 * ONE NUMBER SURVIVES AND IT IS NOT TYPED (AC33). `{kind: 'r2-floor'}` is a
 * checkbox with no input field: `Validate R² >= 0`, structural rather than
 * chosen — the line at which a model stops beating the target's own mean
 * (RMSE/SD(y_true) <= 1 is algebraically R² > 0). Pinned to the validation
 * holdout: R² >= 0 is a THRESHOLD, and openDecision 10's holdout-only
 * narrowing for thresholds was not reopened by this task. Its comparator
 * is derived from `RANK_DIRECTION`, never chosen.
 */
import { RANK_DIRECTION, type RankMetricKey } from './metric-ranking'
import {
  METRIC_SOURCE_LABELS,
  metricValueOf,
  type HoldoutAbsence,
  type SourcedMetrics,
} from './metric-source'
import { METRIC_META, type MetricKey } from './model-metrics'
import type { ResidualSdAbsence, ResidualSdCell } from './residual-sd'

export type ThresholdSource = 'test-split' | 'holdout'

export type ComparisonOperator = 'lt' | 'gt'

/**
 * One side of a comparison. `source` names which figure this operand
 * reads — OMITTED only for a metric with no independent per-source figure
 * of its own (`sd` today, see module doc): that operand resolves from
 * whichever population the run's own residual SD occupies.
 */
export interface ComparisonOperand {
  metric: MetricKey
  source?: ThresholdSource
}

export interface ComparisonPair {
  left: ComparisonOperand
  right: ComparisonOperand
}

export interface ComparisonCriterion {
  kind: 'comparison'
  left: ComparisonOperand
  operator: ComparisonOperator
  right: ComparisonOperand
}

/** AC33. The one surviving number, and it is not typed — a checkbox. */
export interface R2FloorCriterion {
  kind: 'r2-floor'
}

export type AcceptanceCriterion = ComparisonCriterion | R2FloorCriterion

/**
 * Two prior shapes, both retained ONLY so a leftover value can be DETECTED
 * and migrated rather than silently discarded or crashing a render — T07's
 * `{metric, source, value}` and T11's `{left, right, ratio}`. Neither
 * carries `kind`, which is what `isLegacyCriterion` keys on.
 */
export type LegacyAcceptanceCriterion =
  | { metric: RankMetricKey; source: ThresholdSource; value: number }
  | {
      left: { metric: MetricKey; source?: ThresholdSource }
      right: { metric: MetricKey; source?: ThresholdSource }
      ratio: number
    }

function isCurrentCriterion(
  c: AcceptanceCriterion | LegacyAcceptanceCriterion,
): c is AcceptanceCriterion {
  return 'kind' in c
}

/** Detects CURRENT positively (`'kind' in c`) rather than detecting legacy
 *  directly, so an unknown future shape reads as legacy — counted,
 *  clearable, never reaching the evaluator — instead of silently reaching
 *  `evaluateCriterion` with fields it does not have. */
export function isLegacyCriterion(
  c: AcceptanceCriterion | LegacyAcceptanceCriterion,
): c is LegacyAcceptanceCriterion {
  return !isCurrentCriterion(c)
}

export type ThresholdVerdict = 'pass' | 'fail' | 'not-evaluated'

type UnitClass = 'target-units' | 'dimensionless'

const METRIC_UNIT_CLASS: Record<MetricKey, UnitClass> = {
  rmse: 'target-units',
  mae: 'target-units',
  sd: 'target-units',
  r2: 'dimensionless',
}

/** `[larger, smaller]` — the pair this table REFUSES, in either direction
 *  (AC24). T11 used this same table to ORIENT a ratio; T12 uses it to
 *  refuse the pair outright, since a bare comparison on an
 *  algebraically-ordered pair has no discriminating direction at all. */
const KNOWN_INEQUALITIES: readonly (readonly [MetricKey, MetricKey])[] = [
  ['rmse', 'mae'],
  ['rmse', 'sd'],
]

function isKnownInequality(a: MetricKey, b: MetricKey): boolean {
  return KNOWN_INEQUALITIES.some(
    ([larger, smaller]) =>
      (a === larger && b === smaller) || (a === smaller && b === larger),
  )
}

/** Every metric/source combination this system can name — 3 rankable
 *  metrics x 2 pinned sources, 3 rankable metrics run-resolved, plus `sd`
 *  (always run-resolved, never pins — rule 2's whole reason). The universe
 *  `offerablePairs()` draws every candidate pair from, so the offered set
 *  is a DERIVATION over this list rather than a list of pairs itself. */
function allOperands(): ComparisonOperand[] {
  const rankable: MetricKey[] = ['r2', 'rmse', 'mae']
  const sources: ThresholdSource[] = ['test-split', 'holdout']
  const operands: ComparisonOperand[] = []
  for (const source of sources) {
    for (const metric of rankable) operands.push({ metric, source })
  }
  for (const metric of rankable) operands.push({ metric })
  operands.push({ metric: 'sd' })
  return operands
}

function operandKey(op: ComparisonOperand): string {
  return `${op.metric}:${op.source ?? '*'}`
}

function operandEqual(a: ComparisonOperand, b: ComparisonOperand): boolean {
  return operandKey(a) === operandKey(b)
}

/** The four rules from the module doc, applied to one ordered candidate
 *  pair. Symmetric in the pair's two sides by construction, so calling it
 *  on `(a, b)` and `(b, a)` agrees — `offerablePairs()` relies on this to
 *  dedupe without biasing which side becomes canonical `left`. */
function isOfferablePair(a: ComparisonOperand, b: ComparisonOperand): boolean {
  const metricDiffers = a.metric !== b.metric
  const sourceDiffers = a.source !== b.source
  if (metricDiffers === sourceDiffers) return false // identical, or both changed at once

  const aPins = a.source !== undefined
  const bPins = b.source !== undefined
  if (aPins !== bPins) return false // AC29 — pinned never meets run-resolved

  if (METRIC_UNIT_CLASS[a.metric] !== METRIC_UNIT_CLASS[b.metric]) return false // AC25

  if (isKnownInequality(a.metric, b.metric)) return false // AC24

  return true
}

function canonicalPair(pair: ComparisonPair): ComparisonPair {
  return operandKey(pair.left) <= operandKey(pair.right)
    ? pair
    : { left: pair.right, right: pair.left }
}

/** Every comparison a user can pick, derived from `allOperands()` and the
 *  four rules above — never a hand-written list (see module doc). Returns
 *  each unordered pair exactly once, in a stable canonical order, so the
 *  picker and `canonicalise` agree on which side is `left` by default. */
export function offerablePairs(): ComparisonPair[] {
  const operands = allOperands()
  const seen = new Set<string>()
  const pairs: ComparisonPair[] = []
  for (const left of operands) {
    for (const right of operands) {
      if (!isOfferablePair(left, right)) continue
      const pair = canonicalPair({ left, right })
      const key = `${operandKey(pair.left)}|${operandKey(pair.right)}`
      if (seen.has(key)) continue
      seen.add(key)
      pairs.push(pair)
    }
  }
  return pairs
}

export function pairsEqual(a: ComparisonPair, b: ComparisonPair): boolean {
  const ca = canonicalPair(a)
  const cb = canonicalPair(b)
  return operandEqual(ca.left, cb.left) && operandEqual(ca.right, cb.right)
}

function invertOperator(op: ComparisonOperator): ComparisonOperator {
  return op === 'lt' ? 'gt' : 'lt'
}

/** AC31/AC38. Fixes the operand order by the same stable key
 *  `offerablePairs()` canonicalises pairs with, inverting the operator if
 *  the stored order does not already match — so `A < B` and `B > A` commit
 *  to the same criterion. */
export function canonicalise(c: ComparisonCriterion): ComparisonCriterion {
  if (operandKey(c.left) <= operandKey(c.right)) return c
  return {
    kind: 'comparison',
    left: c.right,
    operator: invertOperator(c.operator),
    right: c.left,
  }
}

/** Canonicalised equality — the ONE place "same criterion" is decided, so
 *  the picker's already-added filter and `useRunConfigDraft`'s dirty check
 *  cannot disagree about it. */
export function criterionEqual(
  a: AcceptanceCriterion,
  b: AcceptanceCriterion,
): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'r2-floor') return true
  const ca = canonicalise(a)
  const cb = canonicalise(b as ComparisonCriterion)
  return (
    operandEqual(ca.left, cb.left) &&
    ca.operator === cb.operator &&
    operandEqual(ca.right, cb.right)
  )
}

/** Why an operand's value is absent — T02's own holdout reasons, `sd`'s own
 *  absence causes (`lib/residual-sd.ts`), or a cv-fold-estimate refused at
 *  the operand rather than reached through the absence path (AC28/V18). */
export type OperandAbsence =
  | HoldoutAbsence
  | ResidualSdAbsence
  | 'cross-validation'

export interface OperandReading {
  value: number | null
  absence: OperandAbsence | null
}

export interface CriterionEvaluation {
  verdict: ThresholdVerdict
  left: OperandReading
  right: OperandReading
}

export interface ComparisonFigures {
  sourcedMetrics: SourcedMetrics[]
  /** Null when this surface has no residual-SD figure at all (Step 3's own
   *  preview never fetches the predictions batch). An SD-bearing pair
   *  reads `not-evaluated` here, honestly, rather than a fabricated
   *  number. */
  residualSd: ResidualSdCell | null
  /** T02's own reason a HOLDOUT figure is absent for this run
   *  (`CandidateResult.holdoutAbsence`) — carried here so an absent
   *  holdout operand names WHY rather than degrading to a bare "not
   *  evaluated". Null when a holdout figure is present, or on a surface
   *  that has not fetched holdout absence at all. */
  holdoutAbsence: HoldoutAbsence | null
}

function isRankable(metric: MetricKey): metric is RankMetricKey {
  return metric in RANK_DIRECTION
}

/** THE single derivation of an operand's value — every surface that shows
 *  a figure beside a criterion, and the verdict itself, both call this
 *  (V14: two derivations of one comparison is how a row marked fail comes
 *  to display values that look like they pass). */
function readOperand(
  operand: ComparisonOperand,
  figures: ComparisonFigures,
): OperandReading {
  if (operand.metric === 'sd') {
    const cell = figures.residualSd
    if (!cell || cell.value === null) {
      return { value: null, absence: cell?.absence ?? 'not-recorded' }
    }
    return { value: cell.value, absence: null }
  }

  if (!isRankable(operand.metric)) {
    return { value: null, absence: 'not-recorded' }
  }

  const source = operand.source ?? figures.residualSd?.source ?? null
  if (!source) {
    return { value: null, absence: figures.holdoutAbsence ?? 'not-recorded' }
  }

  // AC28/V18 — refuse the fold mean AT THE OPERAND, before it is ever
  // looked up, because the value is PRESENT rather than missing: a
  // cv-fold-estimate here would be a fold MEAN standing in for a
  // measurement of the shipped refit (MODEL-FLOW-016 finding 3). This is a
  // TYPE-LEVEL guard, latent rather than live today — `residualSdOf` never
  // emits `'cv-fold-estimate'` and no offerable operand pins a source that
  // could resolve to it — but `figures.residualSd?.source` is the
  // three-valued `MetricSource`, so the type permits it and this refuses
  // it explicitly rather than leaving it to fall through as an ordinary
  // absence.
  if ((source as string) === 'cv-fold-estimate') {
    return { value: null, absence: 'cross-validation' }
  }

  const sourced = figures.sourcedMetrics.find(m => m.source === source)
  if (!sourced) {
    return {
      value: null,
      absence:
        source === 'holdout'
          ? (figures.holdoutAbsence ?? 'not-recorded')
          : 'not-recorded',
    }
  }
  const value = metricValueOf(sourced, operand.metric)
  return value === null
    ? { value: null, absence: 'not-recorded' }
    : { value, absence: null }
}

function evaluateComparison(
  criterion: ComparisonCriterion,
  figures: ComparisonFigures,
): CriterionEvaluation {
  const left = readOperand(criterion.left, figures)
  const right = readOperand(criterion.right, figures)
  if (left.value === null || right.value === null) {
    return { verdict: 'not-evaluated', left, right }
  }
  const holds =
    criterion.operator === 'lt'
      ? left.value < right.value
      : left.value > right.value
  return { verdict: holds ? 'pass' : 'fail', left, right }
}

/** AC33. Comparator derived from `RANK_DIRECTION`, never chosen — r2's
 *  direction is `'max'`, so the floor is `>= 0`. */
function evaluateR2Floor(figures: ComparisonFigures): CriterionEvaluation {
  const left = readOperand({ metric: 'r2', source: 'holdout' }, figures)
  const right: OperandReading = { value: 0, absence: null }
  if (left.value === null) return { verdict: 'not-evaluated', left, right }
  const holds = RANK_DIRECTION.r2 === 'max' ? left.value >= 0 : left.value <= 0
  return { verdict: holds ? 'pass' : 'fail', left, right }
}

export function evaluateCriterion(
  criterion: AcceptanceCriterion,
  figures: ComparisonFigures,
): CriterionEvaluation {
  return criterion.kind === 'r2-floor'
    ? evaluateR2Floor(figures)
    : evaluateComparison(criterion, figures)
}

/** One side of a pair/criterion, labelled on its own — the picker's grid
 *  renders each operand separately with an operator toggle between them,
 *  rather than a single combined string. */
export function operandLabel(op: ComparisonOperand): string {
  const label = METRIC_META[op.metric].label
  if (op.source === 'test-split')
    return `${METRIC_SOURCE_LABELS['test-split']} ${label}`
  if (op.source === 'holdout') return `${METRIC_SOURCE_LABELS.holdout} ${label}`
  return label
}

export function operatorSymbol(op: ComparisonOperator): string {
  return op === 'lt' ? '<' : '>'
}

/** For the "Add criteria" picker, which only ever offers a bare pair — no
 *  operator has been chosen yet. */
export function pairLabel(pair: ComparisonPair): string {
  return `${operandLabel(pair.left)} vs ${operandLabel(pair.right)}`
}

/** For a committed criterion of either kind — the row label Step 3 and
 *  Step 4 both render. */
export function criterionLabel(c: AcceptanceCriterion): string {
  if (c.kind === 'r2-floor') return `${METRIC_SOURCE_LABELS.holdout} R² ≥ 0`
  return `${operandLabel(c.left)} ${operatorSymbol(c.operator)} ${operandLabel(c.right)}`
}

const LOSS_ALIGNED_METRIC: Record<string, RankMetricKey> = {
  r2: 'r2',
  rmse: 'rmse',
  mae: 'mae',
  huber: 'mae',
}

/** Which metric to prioritise when suggesting a pair — the one closest to
 *  the training objective. */
export function lossAlignedMetric(loss: string): RankMetricKey | null {
  return LOSS_ALIGNED_METRIC[loss] ?? null
}
