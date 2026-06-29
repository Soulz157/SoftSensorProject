'use client'

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { useWizardNavigation } from '@/hooks/use-wizard-navigation'

const STEPS = [
  'Workspace & plant',
  'Data Source',
  'Tags List',
  'Fetch Data',
  'Raw data',
  // 'Processing',
  // 'Export',
]

interface Props {
  nav: ReturnType<typeof useWizardNavigation>
}

export function WizardStepIndicator({ nav }: Props) {
  return (
    <ol className="flex w-full flex-wrap items-center gap-2">
      {STEPS.map((label, i) => {
        const step = i + 1
        const isActive = step === nav.currentStep
        const isDone = step < nav.currentStep
        const isUnlocked = step <= nav.highestUnlocked
        return (
          <li key={step} className="flex items-center gap-2">
            <button
              type="button"
              disabled={!isUnlocked}
              onClick={() => nav.goTo(step)}
              aria-current={isActive ? 'step' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                isActive && 'bg-muted',
              )}
            >
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  isActive || isDone
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {isDone ? <Check className="h-3.5 w-3.5" /> : step}
              </span>
              <span className="text-sm font-medium">{label}</span>
            </button>
            {step < STEPS.length && (
              <span className="hidden h-px w-6 bg-border sm:block" />
            )}
          </li>
        )
      })}
    </ol>
  )
}
