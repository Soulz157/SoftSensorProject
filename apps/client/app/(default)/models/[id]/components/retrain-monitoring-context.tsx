'use client'

import { Badge } from '@/components/ui/badge'
import { usePredictionMonitoring } from '@/hooks/model/use-prediction-monitoring'
import {
  MONITORING_STATUS_CLASS,
  MONITORING_STATUS_LABEL,
} from '@/lib/drift-status-style'
import type { AIModel } from '@/types'

/**
 * MODEL-SERVE-014-T05. Input-drift context beside the Retrain
 * decision —
 * CONTEXT ONLY. Nothing here gates, blocks or auto-triggers a retrain: no
 * product decision exists for an automatic drift-driven retrain, so this
 * states what monitoring currently measures and stops there.
 *
 * Sourced entirely from `usePredictionMonitoring` — the SAME hook and the
 * same `[from, to]` the Monitoring tab's own `InputDriftPanel` reads,
 * and the same `MONITORING_STATUS_CLASS` palette. No second
 * drift computation is introduced client-side, and no figure here is
 * derived from anything this component fetched on its own.
 *
 * Mounted only while the Retrain dialog is open (it lives inside
 * `DialogContent`), so the fetch happens on the decision, not on every
 * Model Detail render.
 *
 * Every unavailable state is shown EXPLICITLY rather than as a blank or a
 * false OK: `UNKNOWN` (no training range at all) and
 * `INSUFFICIENT_DATA` (a reference exists, live traffic has not cleared the
 * sample floor) are different facts and read differently on screen — see
 * `lib/drift-status-style.ts`'s own note on why they share one palette but
 * not one treatment.
 */
export function RetrainMonitoringContext({ model }: { model: AIModel }) {
  const {
    inputDrift,
    inputDriftLoading: loading,
    inputDriftUnavailableReason,
  } = usePredictionMonitoring(model, '24h')

  // The window the report was ACTUALLY computed over — the backend's own
  // `basis.from`/`basis.to`, never a client-side "last 24h" label that would
  // be false whenever the pool holds a shorter span.
  const basis = inputDrift?.basis ?? null
  const period =
    basis?.from && basis.to
      ? `${new Date(basis.from).toLocaleString()} — ${new Date(basis.to).toLocaleString()}`
      : null

  const driftFlagged =
    inputDrift?.columns.filter(c => c.status === 'WARN' || c.status === 'CRITICAL')
      .length ?? 0

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-foreground">
          Current monitoring
        </p>
        {loading && (
          <span className="text-[11px] text-muted-foreground">Loading…</span>
        )}
      </div>

      {!loading && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              Input drift (training range)
            </span>
            {inputDriftUnavailableReason ? (
              <span className="text-[11px] text-muted-foreground">
                {inputDriftUnavailableReason}
              </span>
            ) : inputDrift ? (
              <>
                <Badge
                  className={`${MONITORING_STATUS_CLASS[inputDrift.status]} border-0 text-[10px]`}
                >
                  {MONITORING_STATUS_LABEL[inputDrift.status]}
                </Badge>
                {driftFlagged > 0 && (
                  <span className="text-[11px] text-muted-foreground">
                    {driftFlagged} of {inputDrift.columns.length} inputs out of
                    training range
                  </span>
                )}
              </>
            ) : (
              <span className="text-[11px] text-muted-foreground">
                No input drift report available
              </span>
            )}
          </div>

          {period && (
            <p className="text-[11px] text-muted-foreground">
              Measured over {period}
              {basis?.plane === 'window'
                ? ' (scheduled inference windows)'
                : ' (logged predictions)'}
            </p>
          )}

          <p className="text-[11px] text-muted-foreground">
            Shown for context — monitoring never starts or blocks a retrain.
          </p>
        </>
      )}
    </div>
  )
}
