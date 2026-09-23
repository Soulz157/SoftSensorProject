'use client'

import {
  AlertTriangle,
  ArrowUpCircle,
  CheckCircle2,
  Loader2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatMetricValue } from '@/lib/model-evaluation'
import {
  RETRAIN_STAGES,
  comparisonView,
  stageBoxState,
  type RetrainPhase,
} from '@/lib/retrain'
import {
  promotableCandidateVersion,
  type RetrainJob,
} from '@/services/model-retrain'
import type { ModelVersionNumber } from '@/lib/model-version-number'

const METRICS: { key: 'rmse' | 'r2' | 'mae'; label: string }[] = [
  { key: 'rmse', label: 'RMSE' },
  { key: 'r2', label: 'R²' },
  { key: 'mae', label: 'MAE' },
]

/**
 * MODEL-SERVE-014. Was driven by a local `setTimeout` sequence and
 * `buildMockMetrics()` — now a pure function of the real `RetrainJob`
 * (`services/model-retrain.ts`), reconstructed on every mount/poll tick
 * rather than owned by this component.
 */
export function RetrainProgress({
  job,
  phase,
  logs,
  onApplyToProduction,
  applying,
  onDismiss,
}: {
  job: RetrainJob | null
  phase: RetrainPhase
  logs: { id: string; level: string; message: string }[]
  /** MODEL-SERVE-014. The explicit decision to put the retrained version
   *  live. Absent = no promote affordance (the retrain itself never
   *  promotes). */
  onApplyToProduction?: (version: ModelVersionNumber) => void
  applying?: boolean
  /** Close this section. A per-viewer preference — it never cancels the
   *  job or touches server state. Absent = no close affordance. */
  onDismiss?: () => void
}) {
  if (phase === 'idle' || !job) return null

  if (phase === 'error') {
    return (
      <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs font-medium text-destructive">
        <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span className="flex-1">
          {job.failureReason
            ? `Retrain failed — ${job.failureReason}`
            : 'Retrain failed — check the model logs and try again.'}
        </span>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Close retrain section"
            className="-m-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground sm:h-8 sm:w-8"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    )
  }

  const view = comparisonView(job.comparison)
  // The REAL numbers, named on screen — "incumbent" is internal vocabulary
  // and told an operator nothing about which version they are looking at.
  const currentVersion = job.comparison?.incumbent.version ?? null
  const candidateVersion = job.comparison?.candidate.version ?? null
  const promotable = promotableCandidateVersion(job.comparison)

  return (
    <div className="space-y-4">
      {onDismiss && (
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">Retrain</p>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Close retrain section"
            className="-m-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground sm:h-8 sm:w-8"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Stage boxes */}
      <div className="grid grid-cols-3 gap-2">
        {RETRAIN_STAGES.map(stage => {
          const state = stageBoxState(stage.key, phase)
          return (
            <div
              key={stage.key}
              className={cn(
                'flex flex-col items-center gap-1.5 rounded-md p-3 text-center transition-colors',
                state === 'done' && 'bg-primary/5 ring-1 ring-primary/20',
                state === 'active' && 'bg-primary/5 ring-1 ring-primary/40',
                state === 'pending' && 'bg-muted/30',
              )}
            >
              {state === 'done' ? (
                <CheckCircle2 className="h-4 w-4 text-primary" />
              ) : state === 'active' ? (
                <Loader2 className="h-4 w-4 text-primary motion-safe:animate-spin" />
              ) : (
                <span className="h-4 w-4 rounded-full border border-muted-foreground/30" />
              )}
              <span
                className={cn(
                  'text-[11px] font-medium',
                  state === 'pending'
                    ? 'text-muted-foreground'
                    : 'text-foreground',
                )}
              >
                {stage.label}
              </span>
            </div>
          )
        })}
      </div>

      {/* Real container logs — no scripted lines */}
      {logs.length > 0 && phase !== 'done' && (
        <div className="max-h-32 space-y-0.5 overflow-y-auto rounded-md bg-muted/30 p-2.5 font-mono text-[11px] text-muted-foreground">
          {logs.slice(-20).map(line => (
            <p key={line.id} className="truncate">
              {line.message}
            </p>
          ))}
        </div>
      )}

      {/* Result */}
      {phase === 'done' && view && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">
              Evaluation
            </p>
            {job.comparison?.candidate.version != null && (
              <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:text-blue-300">
                v{candidateVersion} — STAGING
              </span>
            )}
          </div>

          {/* MODEL-SERVE-017. NEW_DATA_ONLY needs this line MORE than
              AUGMENT_DATA does, not less: a candidate that dropped the
              incumbent's training rows is the one whose basis a reader is
              most likely to misread. Gating on AUGMENT_DATA alone left it
              silent on exactly that case. */}
          {(view.strategy === 'AUGMENT_DATA' ||
            view.strategy === 'NEW_DATA_ONLY') && (
            <p className="text-xs text-muted-foreground">
              Training data:{' '}
              {view.strategy === 'AUGMENT_DATA'
                ? 'existing + new dataset'
                : 'new dataset only — the existing training data was not used'}
              . Compared on the{' '}
              <span className="font-medium text-foreground">
                incumbent&apos;s own frozen test rows
              </span>
              {view.evalSet?.kind !== 'FROZEN_INCUMBENT_TEST' &&
                ' (not yet scored on that set)'}
              .
            </p>
          )}

          {!view.comparable && view.reason && (
            <p className="text-xs text-muted-foreground">
              Not directly comparable to current v{currentVersion}:{' '}
              {view.reason}
            </p>
          )}

          <div className="grid grid-cols-3 gap-2">
            {METRICS.map(({ key, label }) => (
              <div
                key={key}
                className="flex flex-col gap-1 rounded-md bg-muted/30 p-3"
              >
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {label}
                </p>
                <p className="text-lg font-semibold tabular-nums text-foreground">
                  {formatMetricValue(view.candidateMetrics[key])}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  current v{currentVersion}{' '}
                  {formatMetricValue(view.incumbentMetrics[key])}
                </p>
              </div>
            ))}
          </div>

          {/* MODEL-SERVE-015-T04. "Report new dataset evaluation
              separately" — the candidate's OWN test split over the combined
              (mixed-regime) data. Never folded into the grid above, which is
              the frozen-incumbent-test score the delta below is computed
              from. */}
          {view.newRegimeMetrics && (
            <div className="space-y-1.5 rounded-md border border-border bg-muted/10 p-3">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                New-regime evaluation (combined data&apos;s own test split)
              </p>
              <div className="grid grid-cols-3 gap-2">
                {METRICS.map(({ key, label }) => (
                  <div key={key} className="flex flex-col gap-0.5">
                    <p className="text-[10px] text-muted-foreground">{label}</p>
                    <p className="text-sm font-medium tabular-nums text-foreground">
                      {formatMetricValue(view.newRegimeMetrics![key])}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* MODEL-SERVE-014. The explicit decision — a retrain lands a
              STAGING version and stops, so putting v{candidateVersion} live
              is a separate act the operator takes, never a consequence of
              the job finishing. Promotion itself (including the r2-floor
              override path) is the SAME `useModelPromote` flow the page's
              own Promote button uses; this is a second entry point to it,
              not a second implementation. */}
          {promotable !== null && onApplyToProduction && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/20 p-3">
              <p className="text-[11px] text-muted-foreground">
                Keep current v{currentVersion} in production, or put v
                {candidateVersion} live.
              </p>
              <Button
                size="sm"
                className="gap-1.5"
                disabled={applying}
                onClick={() => onApplyToProduction(promotable)}
              >
                <ArrowUpCircle className="h-4 w-4" />
                {applying
                  ? 'Applying…'
                  : `Apply v${candidateVersion} to Production`}
              </Button>
            </div>
          )}

          {view.comparable && view.rmseDelta !== null && (
            <p className="text-xs text-muted-foreground">
              RMSE {view.rmseDelta < 0 ? 'improved' : 'regressed'} by{' '}
              <span className="font-medium text-foreground">
                {Math.abs(view.rmseDelta).toFixed(4)}
              </span>{' '}
              vs. current v{currentVersion}. This candidate was saved as STAGING
              — current v{currentVersion} stays in production until you apply
              it.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
