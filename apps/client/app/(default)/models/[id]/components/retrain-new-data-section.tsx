'use client'

import { formatMetricValue } from '@/lib/model-evaluation'
import type { ComparisonView } from '@/lib/retrain'

const METRICS: { key: 'rmse' | 'r2' | 'mae'; label: string }[] = [
  { key: 'rmse', label: 'RMSE' },
  { key: 'r2', label: 'R²' },
  { key: 'mae', label: 'MAE' },
]

/**
 * MODEL-SERVE-020-T03. Section 2 of the Retrain tab: what the new version
 * scored on the NEW data. Relocated verbatim from `retrain-progress.tsx`
 * (MODEL-SERVE-015-T04/T07, MODEL-SERVE-019) — same panels, same copy, same
 * data sources.
 *
 * ONE figure: the new data the operator set aside, scored on its own and not
 * compared with the current version (it was never scored on these rows).
 *
 * The new version's score on its own combined test data used to sit here too.
 * It moved to section 1 (`RetrainCompareSection`): on the one real retrain
 * measured that split was 97% OLD rows, so a heading about the new data over
 * it was false, and it is the figure that picks the best candidate — it
 * explains the comparison, it does not validate anything on new data.
 *
 * Renders nothing when no window was set aside (or for a Keep Existing job,
 * kept only as history), so the tab never shows an orphaned heading.
 */
export function RetrainNewDataSection({ view }: { view: ComparisonView }) {
  const hasWindow =
    view.newDataHoldoutMetrics !== null || view.newDataHoldoutBasis !== null
  if (!hasWindow) return null

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-muted-foreground">
        Validation on the new data
      </p>

      {/* The operator's NEW-DATA validation window: rows held out of
          training entirely and scored on their own.

          Presented as a standalone figure with NO delta, and that is a
          correctness requirement rather than a layout choice: the current
          version was never scored on these rows, so subtracting its RMSE
          would produce something that looks like a comparison and is not
          one. The only delta on this tab is the one in section 1. */}
      {hasWindow && (
        <div className="space-y-1.5 rounded-md border border-border bg-muted/10 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Performance on the new data (held out of training)
          </p>
          {view.newDataHoldoutMetrics ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                {METRICS.map(({ key, label }) => (
                  <div key={key} className="flex flex-col gap-0.5">
                    <p className="text-[10px] text-muted-foreground">{label}</p>
                    <p className="text-sm font-medium tabular-nums text-foreground">
                      {formatMetricValue(view.newDataHoldoutMetrics![key])}
                    </p>
                  </div>
                ))}
              </div>
              {/* States what was MEASURED, not what was requested — the
                  server echoes back the first/last timestamps of the rows
                  actually held out. */}
              {view.newDataHoldoutRowCount !== null && (
                <p className="text-[10px] text-muted-foreground">
                  {view.newDataHoldoutRowCount.toLocaleString()} rows
                  {view.newDataHoldoutFrom && view.newDataHoldoutTo
                    ? ` from ${new Date(
                        view.newDataHoldoutFrom,
                      ).toLocaleDateString()} to ${new Date(
                        view.newDataHoldoutTo,
                      ).toLocaleDateString()}`
                    : ''}
                  . Not compared against the current model, which was never
                  scored on these rows.
                </p>
              )}
            </>
          ) : (
            // MODEL-SERVE-019-D02. A window was set aside but not yet scored
            // (or scoring soft-failed) — states why instead of hiding the
            // panel or rendering a 0.
            <p className="text-[10px] text-muted-foreground">
              {view.newDataHoldoutBasis?.unavailableReason ??
                'Not recorded for this retrain'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
