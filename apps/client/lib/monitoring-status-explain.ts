/**
 * Tooltip content shared by the monitoring status badges — what a status
 * MEANS, and the arithmetic that actually produced it. The input-drift
 * wording itself lives in `lib/input-drift.ts` (MODEL-SERVE-036).
 *
 * NEVER PRINT A THRESHOLD THE BACKEND DID NOT SEND. A report carries the
 * thresholds its own computation ran with (`basis.thresholds`); a hardcoded
 * literal here would keep rendering confidently after someone moved the env.
 */

/**
 * Separates a criteria line's CONDITION from the VERDICT it produced —
 * `Out of range 6.9% ≥ 5% → WARN`. Exported so
 * `status-badge-with-explanation.tsx` can split on it to style the two
 * halves differently, instead of hunting for a magic arrow character that
 * a copy edit could silently break. A line with no separator is rendered
 * whole — there is no verdict to call out.
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
