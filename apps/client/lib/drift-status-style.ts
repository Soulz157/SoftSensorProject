import type { DriftStatus, PsiStatus } from '@/services/model-monitoring'

/**
 * Shared by `monitoring/drift-panel.tsx` and the Input Data tab's feature
 * table — both describe the same per-column drift signal (live input
 * distribution vs. the PRODUCTION version's own training distribution),
 * so a second copy of this map would be free to drift from the first the
 * moment either UI's palette changed.
 *
 * Deliberately NOT the red/amber "model deployment status" vocabulary
 * (§5 of docs/DESIGN_SYSTEM.md) — that reads as "is the model up", and
 * drift is a different kind of signal (is the INPUT distribution
 * shifting). Uses the data-quality palette instead — neutral for
 * OK/UNKNOWN, purple for WARN/CRITICAL — matching the Bad Data pill
 * convention (quality-summary-badges.tsx) rather than inventing a new
 * mapping.
 */
export const DRIFT_STATUS_CLASS: Record<DriftStatus, string> = {
  OK: 'bg-zinc-500/15 text-zinc-500',
  WARN: 'bg-purple-500/15 text-purple-500',
  CRITICAL: 'bg-purple-700/20 text-purple-700 dark:text-purple-400',
  UNKNOWN: 'bg-zinc-500/10 text-zinc-400',
}

/**
 * MODEL-SERVE-001-T13. PSI's own statuses share OK/WARN/CRITICAL/UNKNOWN's
 * exact treatment above — one signal, one palette, so the two metrics read
 * as siblings rather than two different vocabularies. `INSUFFICIENT_DATA`
 * has no z-score counterpart: it means a real training reference exists
 * and live traffic simply has not cleared the sample floor yet, which is
 * neither a finding (WARN/CRITICAL) nor an absence (UNKNOWN) — the
 * quietest treatment of the five, distinguishing "nothing to report" from
 * "waiting on more data" without borrowing WARN's attention-getting purple.
 */
export const PSI_STATUS_CLASS: Record<PsiStatus, string> = {
  OK: 'bg-zinc-500/15 text-zinc-500',
  WARN: 'bg-purple-500/15 text-purple-500',
  CRITICAL: 'bg-purple-700/20 text-purple-700 dark:text-purple-400',
  UNKNOWN: 'bg-zinc-500/10 text-zinc-400',
  INSUFFICIENT_DATA: 'bg-zinc-500/5 text-zinc-400/80',
}
