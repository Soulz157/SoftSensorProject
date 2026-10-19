import type { Algorithm, HyperparamValue } from '@/store/model-pipeline'
import { ALGORITHM_LABELS } from '@/store/model-pipeline'
import { isSequenceAlgorithm } from '@/lib/metric-source'

/**
 * What each training button sends, decided from Step 3's settings alone — no
 * React, no request. `use-model-training` builds the request from these and
 * nothing else, so every branch is table-tested (`training-launch.test.ts`).
 *
 * MODEL-FLOW-035 (user decision 2026-10-19) splits training in two rounds:
 *
 * - Round 1, Start Training (`planTrainingLaunch`): every selected algorithm
 *   trains ONCE, with its card values. Step 4 / Run parameters then compare
 *   them and the user decides which to fine-tune. Nothing is tuned
 *   automatically any more (the 2026-10-14 SWEEP_THEN_TUNE launch is gone).
 * - Round 2, Fine-tune (`planFineTuneLaunch`): a hyperparameter search over
 *   the ONE algorithm the user picked — the curated grid, the rows they added
 *   by hand, or both — starting from that run's values.
 */

export type HyperparamRecord = Record<string, HyperparamValue>

export interface LaunchCandidate {
  algorithm: Algorithm
  hyperparameters: HyperparamRecord
}

export type CandidateJobKind =
  | 'HYPERPARAMETER_SEARCH'
  | 'ALGORITHM_SWEEP'
  | 'SWEEP_THEN_TUNE'

export type LaunchPlan =
  | { type: 'single'; candidate: LaunchCandidate }
  | {
      type: 'job'
      kind: CandidateJobKind
      candidates: LaunchCandidate[]
      /** Sent only for a grid search on one algorithm (the server appends
       *  them after its curated shortlist). Everywhere else the user's rows
       *  are already in `candidates`. */
      extraVariants?: HyperparamRecord[]
    }

/** `CreateCandidateJobSchema.candidates` is capped at 20: each is a container. */
export const MAX_LAUNCH_CANDIDATES = 20

export interface LaunchInput {
  algorithms: Algorithm[]
  /** The record each algorithm's card would launch with (`baseHyperparamsFor`). */
  baseFor: (algorithm: Algorithm) => HyperparamRecord
  /** Set when Cross-Validation is on. */
  nSplits: number | undefined
}

function sameRecord(a: HyperparamRecord, b: HyperparamRecord): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if ((a[key] ?? null) !== (b[key] ?? null)) return false
  }
  return true
}

/**
 * A card's candidates: its own values first, then each added row laid over
 * them (a row only lists the columns it shows, so the rest come from the
 * card). A row that ends up equal to the card, or to an earlier row, is
 * dropped — with Find Best Parameters off nothing server-side would catch the
 * duplicate fit. A sequence model's window length is the card's, the same
 * rule the server applies to added rows (`distinctExtraVariants`).
 */
export function candidatesFor(
  algorithm: Algorithm,
  base: HyperparamRecord,
  rows: HyperparamRecord[] = [],
): LaunchCandidate[] {
  const carried: HyperparamRecord =
    isSequenceAlgorithm(algorithm) && typeof base.sequence_length === 'number'
      ? { sequence_length: base.sequence_length }
      : {}
  const kept: HyperparamRecord[] = [base]
  for (const row of rows) {
    const merged = { ...base, ...row, ...carried }
    if (!kept.some(other => sameRecord(other, merged))) kept.push(merged)
  }
  return kept.map(hyperparameters => ({ algorithm, hyperparameters }))
}

/**
 * Round 1. Throws with the sentence Step 3 shows when the settings cannot
 * launch. Defense in depth: the controls already prevent each of these.
 */
export function planTrainingLaunch(input: LaunchInput): LaunchPlan {
  const { algorithms, nSplits } = input
  const [first] = algorithms
  if (!first) throw new Error('Select an algorithm before training.')

  const multiAlgorithm = algorithms.length > 1

  // MODEL-FLOW-016, kept by the user on 2026-10-14: a CV run fits one
  // algorithm, and the server refuses CV on anything but a one-algorithm job.
  // CV stays available for Round 2, which is one algorithm by construction.
  if (multiAlgorithm && nSplits !== undefined) {
    throw new Error(
      'Cross-Validation fits one algorithm — remove the others, or turn off Cross-Validation to compare algorithms.',
    )
  }
  if (multiAlgorithm) {
    const sequence = algorithms.find(a => isSequenceAlgorithm(a))
    if (sequence) {
      throw new Error(
        `"${ALGORITHM_LABELS[sequence]}" trains on its own — remove the other algorithms to train or tune it.`,
      )
    }
  }

  const candidates = algorithms.map(a => ({
    algorithm: a,
    hyperparameters: input.baseFor(a),
  }))
  if (candidates.length > MAX_LAUNCH_CANDIDATES) {
    throw new Error(
      `${candidates.length} candidates is more than the ${MAX_LAUNCH_CANDIDATES} one training can run — remove some algorithms.`,
    )
  }

  const [only] = candidates
  if (candidates.length === 1 && only) {
    return { type: 'single', candidate: only }
  }
  return { type: 'job', kind: 'ALGORITHM_SWEEP', candidates }
}

export interface FineTuneInput {
  algorithm: Algorithm
  /** The chosen run's values, sanitised and laid over the algorithm's
   *  defaults (`fineTuneBaseFor`). Always the first candidate that runs. */
  base: HyperparamRecord
  /** The rows the user added to the variants table. */
  rows: HyperparamRecord[]
  /** Find Best Parameters: also try the curated hyperparameter variants. */
  useGrid: boolean
}

/** A fine-tune is always a one-algorithm HYPERPARAMETER_SEARCH job. */
export type FineTunePlan = Extract<LaunchPlan, { type: 'job' }>

/**
 * Round 2. With the curated variants on, the server expands the base into its
 * grid and appends the user's rows after it. With them off, the base and the
 * rows ARE the candidates (the server does not expand a job that already
 * carries more than one) — so there must be at least one row, else it would
 * only repeat the run being tuned.
 */
export function planFineTuneLaunch(input: FineTuneInput): FineTunePlan {
  const { algorithm, base, rows, useGrid } = input

  if (useGrid) {
    return {
      type: 'job',
      kind: 'HYPERPARAMETER_SEARCH',
      candidates: [{ algorithm, hyperparameters: base }],
      ...(rows.length > 0 ? { extraVariants: rows } : {}),
    }
  }

  const candidates = candidatesFor(algorithm, base, rows)
  if (candidates.length < 2) {
    throw new Error(
      'Add a variant that differs from the run being tuned, or turn on Find Best Parameters.',
    )
  }
  if (candidates.length > MAX_LAUNCH_CANDIDATES) {
    throw new Error(
      `${candidates.length} candidates is more than the ${MAX_LAUNCH_CANDIDATES} one training can run — remove some added rows.`,
    )
  }
  return { type: 'job', kind: 'HYPERPARAMETER_SEARCH', candidates }
}
