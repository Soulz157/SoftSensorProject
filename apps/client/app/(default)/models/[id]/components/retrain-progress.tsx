'use client'

import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  RETRAIN_STAGES,
  type EvalMetrics,
  type RetrainPhase,
} from '@/lib/retrain'

const PHASE_ORDER: RetrainPhase[] = [
  'idle',
  'training',
  'validating',
  'evaluating',
  'done',
]

type BoxState = 'pending' | 'active' | 'done'

function stageState(
  stageKey: 'training' | 'validating' | 'evaluating',
  phase: RetrainPhase,
): BoxState {
  if (phase === 'done') return 'done'
  const cur = PHASE_ORDER.indexOf(phase)
  const stage = PHASE_ORDER.indexOf(stageKey)
  if (cur > stage) return 'done'
  if (cur === stage) return 'active'
  return 'pending'
}

const METRICS: { key: keyof EvalMetrics; label: string }[] = [
  { key: 'rmse', label: 'RMSE' },
  { key: 'r2', label: 'R²' },
  { key: 'mae', label: 'MAE' },
]

export function RetrainProgress({
  phase,
  metrics,
}: {
  phase: RetrainPhase
  metrics: EvalMetrics | null
}) {
  if (phase === 'idle') return null

  if (phase === 'error') {
    return (
      <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs font-medium text-destructive">
        <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
        Retrain failed — check the model logs and try again.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Stage boxes */}
      <div className="grid grid-cols-3 gap-2">
        {RETRAIN_STAGES.map(stage => {
          const state = stageState(stage.key, phase)
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

      {/* Eval metrics */}
      {phase === 'done' && metrics && (
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Evaluation Metrics
          </p>
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
                  {metrics[key]}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
