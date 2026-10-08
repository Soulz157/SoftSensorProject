'use client'

import { AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
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
import { RetrainCompareSection } from './retrain-compare-section'
import { RetrainNewDataSection } from './retrain-new-data-section'
import type { LabEventIds } from './basis-lab-events'
import { currentSettingsRunId } from '@/lib/retrain-attribution'

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
  labEventIds,
  currentSettings = null,
}: {
  /** MODEL-SERVE-026-T06. See RetrainTab's own prop. */
  currentSettings?: {
    algorithm: string
    hyperparameters: Record<string, unknown> | null
  } | null
  job: RetrainJob | null
  /** MODEL-SERVE-026-T02. Where each figure's lab-event count is read from.
   *  Absent = no counts rendered. */
  labEventIds?: LabEventIds
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

      {/* Result. MODEL-SERVE-020-T03: sections 1 and 2 of the Retrain tab
          live in their own components; this file keeps the stage boxes,
          logs and failure banner it always owned. */}
      {phase === 'done' && view && (
        <div className="space-y-6">
          <RetrainCompareSection
            view={view}
            currentVersion={currentVersion}
            candidateVersion={candidateVersion}
            promotable={promotable}
            onApplyToProduction={onApplyToProduction}
            applying={applying}
            labEventIds={labEventIds}
            cvFolds={job.cvFolds}
            acceptanceCriteria={job.acceptanceCriteria}
            currentSettingsRunId={
              currentSettings
                ? currentSettingsRunId(job.candidates, currentSettings)
                : null
            }
          />
          <RetrainNewDataSection view={view} labEventIds={labEventIds} />
        </div>
      )}
    </div>
  )
}
