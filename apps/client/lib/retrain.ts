/**
 * Retrain view derivations (single source of truth).
 *
 * Pure module — no React, no IO. Backs the Model Detail retrain flow.
 *
 * MODEL-SERVE-014. Everything here used to be a client-side SIMULATION:
 * `buildMockMetrics` hashed the model id into fake numbers, `buildRetrainLogs`
 * scripted log lines nothing produced, and `REGRESSION_MODELS`/`RetrainConfig`
 * offered 5 client-only algorithm names against a real 12-value
 * `TrainingAlgorithmEnum`, plus a `testSplit` the backend never reads (it is
 * always the incumbent's own split — `TriggerRetrainSchema` is `.strict()`
 * and accepts only `idempotencyKey`/`candidates`). All of that is gone. What
 * remains derives view state from the REAL `RetrainJob`/`RetrainComparison`
 * (`services/model-retrain.ts`) returned by MODEL-SERVE-004's backend.
 */

import type { RetrainComparison, RetrainJob } from '@/services/model-retrain'

/** Ordered stage boxes shown in the retrain progress UI — unchanged shape
 *  from the old simulation's `RETRAIN_STAGES`, now driven by job status
 *  instead of a timer. */
export const RETRAIN_STAGES: {
  key: 'training' | 'validating' | 'evaluating'
  label: string
}[] = [
  { key: 'training', label: 'Training' },
  { key: 'validating', label: 'Validating' },
  { key: 'evaluating', label: 'Result' },
]

export type RetrainPhase =
  | 'idle'
  | 'training'
  | 'validating'
  | 'evaluating'
  | 'done'
  | 'error'

type StageBoxState = 'pending' | 'active' | 'done'

/**
 * MODEL-SERVE-014-T03. Derived from the job's own `status`/`completedRuns`/
 * `totalRuns` — never a local timer. `validating` has no direct backend
 * counterpart (a candidate is QUEUED/RUNNING/SUCCEEDED/FAILED, nothing
 * in-between); it is folded into "training" here since the UI's 3-box
 * layout is retained but nothing server-side distinguishes a validation
 * sub-phase from training itself.
 */
export function retrainPhase(job: RetrainJob | null): RetrainPhase {
  if (!job) return 'idle'
  switch (job.status) {
    case 'QUEUED':
    case 'RUNNING':
      return job.completedRuns > 0 ? 'evaluating' : 'training'
    case 'SUCCEEDED':
      return 'done'
    case 'FAILED':
    case 'CANCELED':
      return 'error'
    default:
      return 'idle'
  }
}

export function stageBoxState(
  stageKey: 'training' | 'validating' | 'evaluating',
  phase: RetrainPhase,
): StageBoxState {
  if (phase === 'done') return 'done'
  if (phase === 'idle' || phase === 'error') return 'pending'
  const order: RetrainPhase[] = ['training', 'validating', 'evaluating']
  const cur = order.indexOf(phase)
  const stage = order.indexOf(stageKey)
  if (cur > stage) return 'done'
  if (cur === stage) return 'active'
  return 'pending'
}

export interface MetricTriple {
  rmse: number | null
  r2: number | null
  mae: number | null
}

/**
 * MODEL-SERVE-014-T04. RMSE is the primary, always-shown figure — the
 * backend's own selection metric, and the one that stayed sane while a real
 * run on this system scored r2 = -1,110,858 (MODEL-FLOW-004's finding).
 * R² and MAE render beside it, never used to decide "better". A delta is
 * only ever returned when `basis.comparable` — otherwise both raw triples
 * are shown with the reason the comparison could not be made.
 */
export interface ComparisonView {
  comparable: boolean
  reason: string | null
  incumbentMetrics: MetricTriple
  candidateMetrics: MetricTriple
  /** Negative = the candidate is better (lower RMSE). Null unless comparable. */
  rmseDelta: number | null
  /** MODEL-SERVE-015. Which invariant `comparable` proves — the UI must
   *  state this alongside a delta rather than imply one universal meaning
   *  of "comparable" (see `RetrainComparison.basis.strategy`'s own note). */
  strategy: 'KEEP_EXISTING' | 'AUGMENT_DATA'
  /** Non-null only for an AUGMENT_DATA job. */
  evalSet: { kind: string | null; checksum: string | null } | null
  /** MODEL-SERVE-015-T04. The candidate's OWN test-split score over the
   *  COMBINED (mixed-regime) data — reported separately, never blended into
   *  `candidateMetrics` (the frozen-incumbent-test score `rmseDelta` is
   *  computed from). Null for a plain (014) retrain. */
  newRegimeMetrics: MetricTriple | null
}

export function comparisonView(
  comparison: RetrainComparison | null,
): ComparisonView | null {
  if (!comparison) return null
  return {
    comparable: comparison.basis.comparable,
    reason: comparison.basis.reason,
    incumbentMetrics: comparison.incumbent.metrics,
    candidateMetrics: comparison.candidate.metrics,
    rmseDelta: comparison.rmseDelta,
    strategy: comparison.basis.strategy,
    evalSet: comparison.basis.evalSet,
    newRegimeMetrics: comparison.candidate.newRegimeMetrics,
  }
}

/** A fresh idempotency key for one trigger attempt — held by the caller
 *  across a retry (never regenerated per attempt) so a dropped response
 *  resolves to the SAME job instead of a second one. */
export function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `retrain-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
