import type { Algorithm, HyperparamValue } from '@/store/model-pipeline'
import { defaultHyperparams } from '@/lib/training-config'
import { cvFoldCountOf } from '@/lib/run-comparison'
import {
  sortRuns,
  splitPercentFromRun,
  toApplyPatch,
  type ScoreMetric,
} from '@/lib/run-params'
import type { ModelTrainingRunListItem } from '@/services/model-draft'

/**
 * MODEL-FLOW-035. Pure rules for Step 3's fine-tune section (Round 2): which
 * run it opens on, what it tunes from, and when it refuses. No IO, no React.
 */

/**
 * The run Fine-tune opens on: the best SUCCEEDED run by the ranking metric
 * (Loss function), newest on a tie. `null` while nothing has succeeded.
 */
export function defaultFineTuneRunId(
  runs: readonly ModelTrainingRunListItem[],
  metric: ScoreMetric,
): string | null {
  const succeeded = runs.filter(run => run.status === 'SUCCEEDED')
  return (
    sortRuns(succeeded, 'score', algorithm => algorithm, metric)[0]?.id ?? null
  )
}

export interface FineTuneChoice {
  algorithm: string
  /** The algorithm's best SUCCEEDED run by the ranking metric — what a pick
   *  of this algorithm tunes from. */
  run: ModelTrainingRunListItem
  /** How many succeeded runs this algorithm has (Round 1 and earlier
   *  fine-tunes alike). */
  runCount: number
}

/**
 * The fine-tune selector's cards: one per algorithm that has a succeeded run,
 * represented by its best run, best algorithm first (newest on a tie). The
 * same shape Round 1's algorithm cards have, so picking a model to tune
 * looks like picking one to train.
 */
export function fineTuneChoicesFor(
  runs: readonly ModelTrainingRunListItem[],
  metric: ScoreMetric,
): FineTuneChoice[] {
  const ordered = sortRuns(
    runs.filter(run => run.status === 'SUCCEEDED'),
    'score',
    algorithm => algorithm,
    metric,
  )
  const choices = new Map<string, FineTuneChoice>()
  for (const run of ordered) {
    const existing = choices.get(run.algorithm)
    if (existing) existing.runCount += 1
    else
      choices.set(run.algorithm, { algorithm: run.algorithm, run, runCount: 1 })
  }
  return [...choices.values()]
}

/**
 * What a fine-tune starts from: the chosen run's recorded hyperparameters,
 * scalar-filtered exactly as Apply does (`toApplyPatch`), laid over the
 * algorithm's full defaults — the same overlay `baseHyperparamsFor` gives a
 * card, so the preview's exclusions and the server's `tuningCandidatesFor`
 * judge the very same record.
 */
export function fineTuneBaseFor(
  algorithm: Algorithm,
  run: Pick<ModelTrainingRunListItem, 'hyperparameters'>,
): Record<string, HyperparamValue> {
  return {
    ...defaultHyperparams(algorithm),
    ...toApplyPatch(run).hyperparameters,
  }
}

export interface FineTuneContext {
  /** The applied target (nav). */
  targetY: string | null
  /** The applied split percentage (nav), and CV k when CV is on. */
  trainTestSplit: number
  nSplits: number | undefined
  /** Unapplied edits in the form above. */
  dirty: boolean
  /** A run or job is already in flight. */
  training: boolean
}

/**
 * Why Fine-tune cannot start, or `null` when it can. A fine-tune's runs are
 * compared with the run it came from, so they must be fit on the same target
 * and the same split; the form must also be applied so what runs is what the
 * user sees.
 *
 * Mixed modes are allowed on purpose: tuning a test-split run with CV on (or
 * the reverse) is a choice, and Step 4 labels each figure's source. Only a
 * SAME-mode mismatch — a different ratio, a different k — is refused.
 */
export function fineTuneBlockReason(
  run: ModelTrainingRunListItem | null,
  ctx: FineTuneContext,
): string | null {
  if (!run) return 'Pick a run to fine-tune.'
  if (ctx.training) return 'Training is in progress.'
  if (ctx.dirty) return 'Apply or discard the unapplied changes first.'
  if (ctx.targetY === null || run.targetY !== ctx.targetY) {
    return `This run predicts ${run.targetY}${
      ctx.targetY ? `, but the applied target is ${ctx.targetY}` : ''
    } — set the target back to compare like with like.`
  }

  const runFolds = cvFoldCountOf(run)
  if (runFolds !== null) {
    if (ctx.nSplits !== undefined && ctx.nSplits !== runFolds) {
      return `This run used ${runFolds}-fold cross-validation, but ${ctx.nSplits} folds are applied.`
    }
    return null
  }
  const runPercent = splitPercentFromRun(run.splitSpec)
  if (
    ctx.nSplits === undefined &&
    Number.isFinite(runPercent) &&
    runPercent !== ctx.trainTestSplit
  ) {
    return `This run used a ${runPercent}/${100 - runPercent} split, but ${ctx.trainTestSplit}/${100 - ctx.trainTestSplit} is applied.`
  }
  return null
}
