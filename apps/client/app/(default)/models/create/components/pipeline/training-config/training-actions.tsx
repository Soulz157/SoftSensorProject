'use client'

import { Cpu, Loader2, Timer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { RuntimeInput } from '@/lib/model/estimate-runtime'
import type { TrainState } from '@/store/model-pipeline'
import { RuntimeEstimate } from './runtime-estimate'

interface Props {
  estimate: RuntimeInput
  train: TrainState
  /** Button label when not training: "Start Training" or "Start Fine-tune". */
  label: string
  onStart: () => void
  disabled: boolean
  refusal: string | null
  dirty: boolean
  doneText: string
}

/**
 * MODEL-FLOW-036. Step 3's ONE action: runtime estimate, the Start button
 * and its feedback lines, lifted out of phase-3-training-config.tsx (a page
 * is a composition shell). The same button trains the base models or
 * fine-tunes the picked run — the caller passes the mode's label/estimate.
 */
export function TrainingActions({
  estimate,
  train,
  label,
  onStart,
  disabled,
  refusal,
  dirty,
  doneText,
}: Props) {
  const training = train.status === 'training'

  return (
    <section className="space-y-4 rounded-xl border border-border/60 bg-muted/30 p-4 sm:p-5">
      <div className="flex items-center gap-2 border-b border-border/50 pb-2">
        <Timer className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-medium text-foreground">
          {training ? 'Training progress' : 'Estimated runtime'}
        </h3>
      </div>

      <RuntimeEstimate
        {...estimate}
        status={train.status}
        progress={train.progress}
      />

      {/* The action and its own feedback on one line — the estimate above is
      read first by position, not by hoping the user looks right. */}
      <div className="flex flex-col gap-3 border-t border-border/50 pt-4 sm:flex-row-reverse sm:items-center sm:justify-between">
        <Button
          onClick={onStart}
          disabled={disabled}
          className="w-full shrink-0 cursor-pointer gap-2 sm:w-auto"
        >
          {training ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Cpu className="h-4 w-4" />
          )}
          {training ? 'Training…' : label}
        </Button>

        <div className="min-w-0 flex-1 space-y-1">
          {refusal && !training && (
            <p className="text-xs text-destructive">{refusal}</p>
          )}
          {dirty && !training && (
            <p className="text-xs text-muted-foreground">
              Apply the changes above to start training with them.
            </p>
          )}
          {training && (
            // A fit has no reportable percentage (MODEL-FLOW-003-T09) —
            // train.py emits log lines, not a fraction. Showing the latest one
            // is more honest than a bar that fakes a fraction.
            <p className="truncate text-xs text-muted-foreground">
              {train.lastLog ?? 'Training container starting…'}
            </p>
          )}
          {train.status === 'error' && (
            <p className="text-xs text-destructive">{train.error}</p>
          )}
          {train.status === 'done' && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">
              {doneText}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
