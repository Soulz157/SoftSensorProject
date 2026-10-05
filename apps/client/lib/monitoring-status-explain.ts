import type {
  PsiColumn,
  PsiReport,
  PsiStatus,
} from '@/services/model-monitoring'
import { MONITORING_STATUS_LABEL } from '@/lib/drift-status-style'

/**
 * Tooltip content for the PSI status badges — what a status MEANS, and the
 * arithmetic that actually produced it. PSI is the only input-drift signal
 * since MODEL-SERVE-028 removed the z-score drift card.
 *
 * Pure derivation, so it lives here rather than in a panel: every surface
 * that shows a PSI badge (Monitoring card, Input Data table, retrain dialog)
 * must agree on what "WARN" claims, and a copy in each component is a copy
 * free to disagree.
 *
 * NEVER PRINT A THRESHOLD THE BACKEND DID NOT SEND. The report carries the
 * thresholds its own computation ran with (`basis.thresholds`); a hardcoded
 * 0.1/0.25 here would keep rendering confidently after someone moved
 * PSI_WARN.
 */

/**
 * Separates a criteria line's CONDITION from the VERDICT it produced —
 * `PSI 0.180 ≥ 0.1 → WARN`. Exported so
 * `status-badge-with-explanation.tsx` can split on it to style the two
 * halves differently, instead of hunting for a magic arrow character that
 * a copy edit here would silently break. A line with no separator (an
 * under-the-line reading, e.g. `PSI 0.02 < 0.1 → Good`) is rendered whole
 * — there is no verdict to call out.
 *
 * EVERY criteria line now carries a verdict, including the ones that did
 * NOT breach: an under-the-line reading ends in "Good" rather than the
 * old "(warn line)" parenthetical, so the tooltip shows a green badge
 * saying the comparison passed instead of naming a line it stayed under.
 */
export const CRITERIA_VERDICT_SEPARATOR = ' → '

export interface StatusExplanation {
  /** What this status asserts, in one sentence. Always present. */
  meaning: string
  /** Measured-vs-threshold lines, in the order the backend tests them.
   *  EMPTY when the report carried no thresholds, or when the status has
   *  no numeric criteria (UNKNOWN has no verdict to explain). */
  criteria: string[]
}

const PSI_MEANING: Record<PsiStatus, string> = {
  OK: 'The live distribution of this input still overlaps its frozen training bins.',
  WARN: 'The live distribution has shifted noticeably against its training bins.',
  CRITICAL:
    'The live distribution barely resembles the one this model trained on.',
  UNKNOWN:
    'No verdict. No training reference exists for this column, so no comparison was possible — an absence of information, not a clean bill of health.',
  INSUFFICIENT_DATA:
    'Not enough live traffic yet. A real training reference exists; PSI is simply not computed below its sample floor rather than published on thin evidence.',
}

/**
 * Per-column PSI explanation. `thresholds` is `report.basis.thresholds`; it
 * is undefined only when no report has loaded yet (the Input Data table can
 * render before the PSI fetch settles), and every numeric line is then
 * dropped rather than guessed. PSI has exactly ONE numeric rule — the index
 * against warn/critical. `outOfRangePct` rides the same column but is never
 * quoted as a criterion: the backend deliberately keeps it out of `psi`
 * (the reference has no defined mass outside its own edges), so it is
 * evidence beside the verdict, not part of it. The tooltip must not imply
 * otherwise.
 */
export function explainPsiColumn(
  col: Pick<PsiColumn, 'psi' | 'status' | 'reason' | 'liveTotal' | 'bins'>,
  thresholds: PsiReport['basis']['thresholds'] | undefined,
): StatusExplanation {
  const meaning = col.reason
    ? `${PSI_MEANING[col.status]} (${col.reason})`
    : PSI_MEANING[col.status]

  if (!thresholds) return { meaning, criteria: [] }

  // The rows-vs-floor readout IS this status's criterion — the sample
  // floor is the rule that fired. There is no PSI value to quote.
  if (col.status === 'INSUFFICIENT_DATA') {
    const bins = col.bins
    return {
      meaning,
      criteria: bins
        ? [
            `${col.liveTotal} of ${bins.minSamples} rows required`,
            `floor = ${bins.binCount} bins × ${thresholds.minSamplesPerBin} rows per bin`,
          ]
        : [],
    }
  }

  if (col.status === 'UNKNOWN' || col.psi === null) {
    return { meaning, criteria: [] }
  }

  const value = col.psi.toFixed(3)
  const criteria: string[] = []
  if (col.psi >= thresholds.critical) {
    criteria.push(
      `PSI ${value} ≥ ${thresholds.critical}${CRITERIA_VERDICT_SEPARATOR}CRITICAL`,
    )
  } else if (col.psi >= thresholds.warn) {
    criteria.push(
      `PSI ${value} ≥ ${thresholds.warn}${CRITERIA_VERDICT_SEPARATOR}WARN (critical at ${thresholds.critical})`,
    )
  } else {
    criteria.push(
      `PSI ${value} < ${thresholds.warn}${CRITERIA_VERDICT_SEPARATOR}${MONITORING_STATUS_LABEL.OK}`,
    )
  }

  return { meaning, criteria }
}

/** The PSI card header. The report status is the WORST column status, so
 *  the tooltip describes the roll-up rather than borrowing one column's
 *  number, which would misattribute the verdict. */
export function explainPsiReport(report: PsiReport): StatusExplanation {
  const meaning = PSI_MEANING[report.status]
  const total = report.columns.length
  const hits = report.columns.filter(c => c.status === report.status).length

  if (report.status === 'UNKNOWN') {
    return {
      meaning: `${meaning} No column in this report produced a comparable verdict.`,
      criteria: [],
    }
  }

  const label =
    report.status === 'INSUFFICIENT_DATA' ? 'insufficient data' : report.status

  return {
    meaning: `Worst verdict across ${total} input${total === 1 ? '' : 's'}. ${meaning}`,
    criteria: [
      `${hits} of ${total} inputs at ${label}`,
      `warn ≥ ${report.basis.thresholds.warn}, critical ≥ ${report.basis.thresholds.critical}`,
    ],
  }
}
