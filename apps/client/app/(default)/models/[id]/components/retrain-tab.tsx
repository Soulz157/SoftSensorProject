'use client'

import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { RetrainPhase } from '@/lib/retrain'
import type { RetrainJob } from '@/services/model-retrain'
import type { ModelVersionNumber } from '@/lib/model-version-number'
import { RetrainCharts } from './retrain-charts'
import { RetrainProgress } from './retrain-progress'

/**
 * MODEL-SERVE-020-T02. The Retrain tab — a composition shell. The retrain
 * flow used to be split across two places on Model Detail: a header button
 * and a progress/result panel above the stat cards. Both now live here, so
 * there is exactly one Retrain entry point and one place the result is read.
 *
 * State stays with the page (`useModelRetrain`, `useModelPromote`, the dialog):
 * they outlive a tab switch, and the polling job must keep running while the
 * operator looks at another tab. This component only arranges what the page
 * hands it.
 *
 * Sections, in order: the comparison with the current version, the results
 * on the new data (both inside `RetrainProgress`, MODEL-SERVE-020-T03), then
 * the Actual vs Predicted and Residual charts (MODEL-SERVE-020-T05).
 */
export function RetrainTab({
  modelId,
  job,
  phase,
  logs,
  isRetraining,
  onStartRetrain,
  applying,
  onApplyToProduction,
  currentSettings = null,
}: {
  modelId: string
  /** MODEL-SERVE-026-T06. The current version's own configuration, to find
   *  which candidate is "B" (those settings refitted on the new data). */
  currentSettings?: {
    algorithm: string
    hyperparameters: Record<string, unknown> | null
  } | null
  /** The retrain job, or null when there is none. Never hidden by the old
   *  panel's per-viewer close: on this tab the finished result is the content,
   *  and closing it would leave nothing to bring it back with. */
  job: RetrainJob | null
  phase: RetrainPhase
  logs: { id: string; level: string; message: string }[]
  isRetraining: boolean
  /** Opens the existing retrain dialog. */
  onStartRetrain: () => void
  applying: boolean
  onApplyToProduction: (version: ModelVersionNumber) => void
}) {
  const idle = phase === 'idle' || job === null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <p className="text-sm font-medium text-foreground">Retrain</p>
          <p className="text-xs text-muted-foreground">
            Train a new version on new data and compare it with the current one.
            A retrain never replaces the current version on its own.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={isRetraining}
          onClick={onStartRetrain}
        >
          <RefreshCw className="h-4 w-4" />
          {isRetraining ? 'Retraining…' : 'Retrain'}
        </Button>
      </div>

      {idle ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
          No retrain to show yet. Choose Retrain to start one — the comparison
          and charts appear here when it finishes.
        </div>
      ) : (
        <>
          <RetrainProgress
            labEventIds={{
              modelId,
              candidateRunId: job.comparison?.candidate.runId ?? null,
              incumbentSourceRunId:
                job.comparison?.incumbent.sourceRunId ?? null,
            }}
            job={job}
            currentSettings={currentSettings}
            phase={phase}
            logs={logs}
            applying={applying}
            onApplyToProduction={onApplyToProduction}
          />
          {/* Sections 3 and 4 (MODEL-SERVE-020-T05). Only for a finished job
              that has a comparison: the series exist only once a candidate
              has succeeded, and nothing here is meaningful before that. */}
          {phase === 'done' && job.comparison && (
            <RetrainCharts
              modelId={modelId}
              comparison={job.comparison}
              currentVersion={job.comparison.incumbent.version}
            />
          )}
        </>
      )}
    </div>
  )
}
