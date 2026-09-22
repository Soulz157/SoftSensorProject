import type { PsiStatus } from '@/services/model-monitoring'

/**
 * The ONE treatment for every drift and PSI status badge in the app — the
 * Monitoring tab's Distribution Drift and PSI cards, the Input Data tab's
 * feature table, and the retrain dialog's monitoring context.
 *
 * WHY ONE MAP. This started as two: a traffic light for the monitoring
 * CARDS and a neutral/purple treatment everywhere else, so that the Input
 * Data table's drift badge would not compete with the PI health badge in
 * the adjacent cell. In practice the split just meant the SAME verdict
 * rendered green on one tab and zinc on another, which reads as a bug
 * rather than as a distinction. Unified on request: one verdict, one
 * colour, wherever it appears.
 *
 * This overrides the red/amber reservation in §5 of
 * docs/DESIGN_SYSTEM.md (red/amber for workspace and plant operating
 * state) for drift and PSI specifically.
 *
 * `UNKNOWN` and `INSUFFICIENT_DATA` stay neutral on purpose. The first is
 * an absence of any verdict and the second is "not enough live traffic
 * yet" — neither is a healthy result, so neither may read as green.
 *
 * Keyed by `PsiStatus` because that union is a superset of `DriftStatus`
 * (it adds `INSUFFICIENT_DATA`), so one map safely serves both.
 */
export const MONITORING_STATUS_CLASS: Record<PsiStatus, string> = {
  OK: 'bg-green-500/15 text-green-600 dark:text-green-400',
  WARN: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
  CRITICAL: 'bg-red-500/15 text-red-600 dark:text-red-400',
  UNKNOWN: 'bg-zinc-500/10 text-zinc-400',
  INSUFFICIENT_DATA: 'bg-zinc-500/5 text-zinc-400/80',
}

/**
 * The same verdicts as badges INSIDE A TOOLTIP, which is a different
 * surface and therefore needs different numbers.
 *
 * `TooltipContent` (components/ui/tooltip.tsx) paints itself
 * `bg-foreground text-background` — an INVERTED surface: near-black in
 * the light theme, near-white in the dark one. That is the opposite of
 * every other place a status badge appears, so `MONITORING_STATUS_CLASS`
 * cannot be reused here: its `text-green-600` is a mid-dark green, fine
 * on a card and nearly invisible on near-black.
 *
 * Hence the inverted pairs below — a LIGHT tone by default (the tooltip
 * is dark then) and a DARK tone under `dark:` (the tooltip is light
 * then). Reading `dark:text-green-700` as a mistake is the trap; it is
 * correct precisely because this surface runs against the theme.
 *
 * Switching the bubble to a normal card surface instead was rejected:
 * `TooltipContent`'s arrow is hardcoded `bg-foreground fill-foreground`
 * inside that generated component, which is immutable under CLAUDE.md,
 * so the bubble would no longer match its own arrow.
 */
export const MONITORING_STATUS_CLASS_ON_TOOLTIP: Record<PsiStatus, string> = {
  OK: 'bg-green-500/25 text-green-300 dark:bg-green-600/20 dark:text-green-700',
  WARN: 'bg-yellow-500/25 text-yellow-200 dark:bg-yellow-600/20 dark:text-yellow-700',
  CRITICAL: 'bg-red-500/25 text-red-300 dark:bg-red-600/20 dark:text-red-700',
  UNKNOWN: 'bg-background/15 text-background/70',
  INSUFFICIENT_DATA: 'bg-background/10 text-background/60',
}

/**
 * Wording, applied everywhere the map above is. The wire value `OK`
 * renders as "Good": the badge answers "how is this input doing", and
 * "Good" reads as an assessment where "OK" reads as a shrug. Only the
 * DISPLAY changes — the `DriftStatus`/`PsiStatus` values crossing the
 * wire are untouched, and every test and API contract still speaks `OK`.
 *
 * `INSUFFICIENT_DATA` keeps the prose form MODEL-SERVE-001-T13's DISPLAY
 * SPEC quotes verbatim; it used to live in `psi-panel.tsx`'s own local
 * `psiStatusLabel`.
 *
 * NOTE for the Input Data tab: this "Good" sits one cell away from the PI
 * health badge's own `Good` (`pi-status-style.ts`). They answer different
 * questions — "has the distribution moved since training" vs. "is PI
 * reporting usable data right now" — and the column headers (Drift / PI)
 * are what distinguishes them. Accepted deliberately in favour of one
 * consistent vocabulary; see the status tooltip for what each asserts.
 */
export const MONITORING_STATUS_LABEL: Record<PsiStatus, string> = {
  OK: 'Good',
  WARN: 'WARN',
  CRITICAL: 'CRITICAL',
  UNKNOWN: 'UNKNOWN',
  INSUFFICIENT_DATA: 'Insufficient data',
}
