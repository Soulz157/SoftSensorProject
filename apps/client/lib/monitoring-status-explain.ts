import type {
  DriftColumn,
  DriftReport,
  DriftStatus,
  PsiColumn,
  PsiReport,
  PsiStatus,
} from '@/services/model-monitoring'
import { MONITORING_STATUS_LABEL } from '@/lib/drift-status-style'

/**
 * Tooltip content for the status badges on the two monitoring-tab cards —
 * what a status MEANS, and the arithmetic that actually produced it.
 *
 * Pure derivation, so it lives here rather than in either panel: the two
 * cards must agree on what "WARN" claims, and a copy in each component is
 * a copy free to disagree.
 *
 * TWO RULES THIS MODULE EXISTS TO HOLD.
 *
 * 1. NEVER PRINT A THRESHOLD THE BACKEND DID NOT SEND. Both reports carry
 *    the thresholds their own computation ran with (`basis.thresholds`);
 *    `PsiReport`'s own type comment already demanded this for PSI. Drift's
 *    equivalent is OPTIONAL, because a backend deployed before it shipped
 *    sends none — in that case every `criteria` line is omitted and the
 *    tooltip explains the MEANING alone. A hardcoded 1.5/3.0 here would
 *    keep rendering confidently after someone moved DRIFT_WARN_SD.
 *
 * 2. NAME THE RULE THAT ACTUALLY FIRED. A drift column is WARN when
 *    `|z| >= warnSd` OR when `outOfRangePct >= threshold` — see
 *    `statusFor` in apps/backend/src/lib/prediction-drift.ts. A column at
 *    z = +0.30 with 12% out of range is WARN on the SECOND rule, and a
 *    tooltip reading "|z| above 1.5" there would be flatly false. So the
 *    predicate is re-evaluated per column against the published
 *    thresholds and every rule that fired is listed.
 */

/**
 * Separates a criteria line's CONDITION from the VERDICT it produced —
 * `|z| 2.14 ≥ 1.5 → WARN`. Exported so
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

function pct(value: number): string {
  return `${value.toFixed(1)}%`
}

function abs(value: number, digits = 2): string {
  return Math.abs(value).toFixed(digits)
}

const DRIFT_MEANING: Record<DriftStatus, string> = {
  OK: 'This input still matches the distribution the production version trained on.',
  WARN: 'This input has moved away from its training distribution.',
  CRITICAL:
    'This input has moved far from its training distribution. The model is predicting on data unlike what it learned from.',
  UNKNOWN:
    'No verdict. The training baseline for this column is missing or degenerate, so no comparison was possible — an absence of information, not a clean bill of health.',
}

/**
 * Per-column drift explanation. `thresholds` is `report.basis.thresholds`
 * and may be undefined; every numeric line is then dropped rather than
 * guessed.
 */
export function explainDriftColumn(
  col: Pick<DriftColumn, 'z' | 'outOfRangePct' | 'status' | 'reason'>,
  thresholds: DriftReport['basis']['thresholds'],
): StatusExplanation {
  const meaning = col.reason
    ? `${DRIFT_MEANING[col.status]} (${col.reason})`
    : DRIFT_MEANING[col.status]

  // UNKNOWN has no arithmetic behind it by construction — `computeDrift`
  // never computed a z here. `col.reason` carries the specific cause and
  // is folded into `meaning` above.
  if (col.status === 'UNKNOWN' || !thresholds) {
    return { meaning, criteria: [] }
  }

  const criteria: string[] = []

  if (col.z !== null) {
    const az = Math.abs(col.z)
    // Tested in the backend's own order — critical first, so a column past
    // both lines is explained by the one that actually decided it.
    if (az >= thresholds.criticalSd) {
      criteria.push(
        `|z| ${abs(col.z)} ≥ ${thresholds.criticalSd}${CRITERIA_VERDICT_SEPARATOR}CRITICAL`,
      )
    } else if (az >= thresholds.warnSd) {
      criteria.push(
        `|z| ${abs(col.z)} ≥ ${thresholds.warnSd}${CRITERIA_VERDICT_SEPARATOR}WARN`,
      )
    } else {
      criteria.push(
        `|z| ${abs(col.z)} < ${thresholds.warnSd}${CRITERIA_VERDICT_SEPARATOR}${MONITORING_STATUS_LABEL.OK}`,
      )
    }
  }

  if (col.outOfRangePct !== null) {
    // The "(this rule never reaches CRITICAL)" suffix and the
    // estimated-vs-counted note were both cut as too wordy for a tooltip.
    // Both facts still hold: out-of-range can only raise a column to WARN
    // (see `statusFor`), and the percentage is a parametric ESTIMATE
    // (`estimateOutOfRangePct`), which the column header marks "(est.)".
    // Do not re-add either here without being asked.
    const breached = col.outOfRangePct >= thresholds.outOfRangePct
    criteria.push(
      breached
        ? `out-of-range ${pct(col.outOfRangePct)} ≥ ${pct(thresholds.outOfRangePct)}${CRITERIA_VERDICT_SEPARATOR}WARN`
        : `out-of-range ${pct(col.outOfRangePct)} < ${pct(thresholds.outOfRangePct)}${CRITERIA_VERDICT_SEPARATOR}${MONITORING_STATUS_LABEL.OK}`,
    )
  }

  return { meaning, criteria }
}

/**
 * The card-header drift badge. The report status is the WORST column
 * status, so the tooltip says exactly that rather than repeating one
 * column's arithmetic — the header is not about any single column, and
 * borrowing one column's numbers would misattribute the verdict.
 */
export function explainDriftReport(report: DriftReport): StatusExplanation {
  const meaning = DRIFT_MEANING[report.status]
  const total = report.columns.length
  const hits = report.columns.filter(c => c.status === report.status).length

  if (report.status === 'UNKNOWN') {
    return {
      meaning: `${meaning} No column in this report produced a comparable verdict.`,
      criteria: [],
    }
  }

  return {
    meaning: `Worst verdict across ${total} input${total === 1 ? '' : 's'}. ${meaning}`,
    criteria: [
      `${hits} of ${total} inputs at ${report.status}`,
      'Hover a row’s own Status for the numbers behind it.',
    ],
  }
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
 * Per-column PSI explanation. Unlike drift, PSI has exactly ONE numeric
 * rule — the index against warn/critical. No second predicate can raise
 * the status independently, so `outOfRangePct` is never quoted as a
 * criterion here: the backend deliberately keeps it out of `psi` (the
 * reference has no defined mass outside its own edges), and the tooltip
 * must not imply otherwise.
 */
export function explainPsiColumn(
  col: Pick<PsiColumn, 'psi' | 'status' | 'reason' | 'liveTotal' | 'bins'>,
  thresholds: PsiReport['basis']['thresholds'],
): StatusExplanation {
  const meaning = col.reason
    ? `${PSI_MEANING[col.status]} (${col.reason})`
    : PSI_MEANING[col.status]

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

/** The PSI card header. Same rule as the drift header: worst column wins,
 *  so the tooltip describes the roll-up rather than one column's number. */
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
