import type { DriftStatus } from '@/services/model-monitoring'

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
