'use client'

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  labels: string[]
  currentStep: number
  highestUnlocked: number
  onGoTo: (step: number) => void
}

export function WizardStepIndicator({
  labels,
  currentStep,
  highestUnlocked,
  onGoTo,
}: Props) {
  return (
    <div
      className="grid w-full items-start"
      style={{
        gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))`,
      }}
    >
      {labels.map((label, idx) => {
        const step = idx + 1
        const isActive = step === currentStep
        const isDone = step < currentStep
        const isClickable = step <= highestUnlocked && step !== currentStep

        return (
          <div key={label} className="relative flex flex-col items-center">
            {idx > 0 && (
              <div className="pointer-events-none absolute left-0 top-4 h-px w-full -translate-x-1/2 px-5">
                <div
                  className={cn(
                    'h-px w-full transition-colors',
                    step <= currentStep ? 'bg-primary' : 'bg-border',
                  )}
                />
              </div>
            )}
            <button
              type="button"
              disabled={!isClickable}
              onClick={() => isClickable && onGoTo(step)}
              className={cn(
                'flex flex-col items-center gap-1 rounded-lg px-2 py-1 text-center transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                isClickable && 'cursor-pointer hover:bg-muted',
                !isClickable && 'cursor-default',
              )}
            >
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                  isActive &&
                    'bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2 ring-offset-background',
                  isDone && 'bg-primary text-primary-foreground',
                  !isActive &&
                    !isDone &&
                    step <= highestUnlocked &&
                    'bg-muted text-muted-foreground',
                  step > highestUnlocked &&
                    'bg-muted/50 text-muted-foreground/50',
                )}
              >
                {isDone ? <Check className="h-3 w-3" /> : step}
              </span>
              <span
                className={cn(
                  'whitespace-nowrap text-[10px] font-medium leading-none',
                  isActive ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {label}
              </span>
            </button>

            {idx < labels.length - 1 && (
              <div
                className={cn(
                  'mx-1 h-px min-w-6 flex-1 transition-colors',
                  step < currentStep ? 'bg-primary' : 'bg-border',
                )}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
