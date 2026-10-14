import type { Algorithm, HyperparamValue } from '@/store/model-pipeline'
import { ALGORITHM_LABELS } from '@/store/model-pipeline'
import { isSequenceAlgorithm } from '@/lib/metric-source'

/**
 * What Start Training sends, decided from Step 3's settings alone — no React,
 * no request. `use-model-training` builds the request from this and nothing
 * else, so every branch here is table-tested (`training-launch.test.ts`).
 *
 * Training several candidates at once is the default (user decision
 * 2026-10-14, which removed Find Best Model): every selected algorithm with
 * its card values, plus every row the user added on that card. Step 4 then
 * compares them and recommends the lowest score. Find Best Parameters only
 * ADDS the curated grid: on one algorithm it searches that algorithm, on two
 * or more it tunes whichever candidate wins the first round.
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
  extraVariants: Partial<Record<Algorithm, HyperparamRecord[]>>
  findBestParams: boolean
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
 * Throws with the sentence Step 3 shows when the settings cannot launch.
 * Defense in depth: the controls already prevent each of these.
 */
export function planTrainingLaunch(input: LaunchInput): LaunchPlan {
  const { algorithms, findBestParams, nSplits } = input
  const [first] = algorithms
  if (!first) throw new Error('Select an algorithm before training.')

  const multiAlgorithm = algorithms.length > 1

  // MODEL-FLOW-016, kept by the user on 2026-10-14: a CV run fits one
  // algorithm, and the server refuses CV on anything but a one-algorithm job.
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

  // One algorithm with Find Best Parameters: the server expands the card into
  // the curated grid and appends the user's rows after it — unchanged.
  if (!multiAlgorithm && findBestParams) {
    const rows = input.extraVariants[first] ?? []
    return {
      type: 'job',
      kind: 'HYPERPARAMETER_SEARCH',
      candidates: [{ algorithm: first, hyperparameters: input.baseFor(first) }],
      ...(rows.length > 0 ? { extraVariants: rows } : {}),
    }
  }

  const candidates = algorithms.flatMap(a =>
    candidatesFor(a, input.baseFor(a), input.extraVariants[a]),
  )
  if (candidates.length > MAX_LAUNCH_CANDIDATES) {
    throw new Error(
      `${candidates.length} candidates is more than the ${MAX_LAUNCH_CANDIDATES} one training can run — remove some added rows or algorithms.`,
    )
  }

  const [only] = candidates
  if (candidates.length === 1 && only) {
    return { type: 'single', candidate: only }
  }

  if (!multiAlgorithm) {
    // One algorithm, several rows, no grid: a search over exactly these rows.
    // With more than one candidate the server does not expand the grid, and
    // it is the one job kind that accepts Cross-Validation.
    return { type: 'job', kind: 'HYPERPARAMETER_SEARCH', candidates }
  }

  return {
    type: 'job',
    kind: findBestParams ? 'SWEEP_THEN_TUNE' : 'ALGORITHM_SWEEP',
    candidates,
  }
}
