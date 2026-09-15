import type { PiTagStatus } from '@/services/model-monitoring'

/**
 * MODEL-SERVE-001-T15. PI's own per-tag quality — a HEALTH signal, so it
 * uses the health palette (emerald / amber / red), matching the per-cell
 * quality dots `data-visualize/components/data-table-view.tsx` already
 * shows for the same Good/Questionable/Bad vocabulary.
 *
 * Deliberately NOT `drift-status-style.ts`'s palette: that module states
 * its own reason for being neutral/purple — drift asks "has the input
 * distribution shifted", which is not a health verdict and must not borrow
 * the alarm colours. This one IS a health verdict: a Bad tag means the
 * sensor is not reporting usable data right now.
 *
 * `UNKNOWN` stays neutral — PI said nothing about the tag, which is an
 * absence of information, not a fault to raise an alarm about.
 */
export const PI_STATUS_CLASS: Record<PiTagStatus, string> = {
  Good: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  Questionable: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  Bad: 'bg-red-500/15 text-red-600 dark:text-red-400',
  UNKNOWN: 'bg-zinc-500/10 text-zinc-400',
}
