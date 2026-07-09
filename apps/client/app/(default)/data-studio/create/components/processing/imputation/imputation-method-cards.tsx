'use client'

import { Check } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { FillStrategy } from '@/lib/preprocessing'

interface Props {
  value: FillStrategy
  constantValue: number | undefined
  onChange: (strategy: FillStrategy) => void
  onConstantChange: (value: number) => void
}

const STRATEGY_CARDS: {
  value: FillStrategy
  label: string
  description: string
}[] = [
  { value: 'drop', label: 'Drop row', description: 'Remove gaps entirely' },
  {
    value: 'forward',
    label: 'Forward Fill',
    description: 'Use previous value',
  },
  { value: 'backward', label: 'Backward Fill', description: 'Use next value' },
  { value: 'mean', label: 'Fill Mean', description: 'Average of series' },
  { value: 'median', label: 'Median', description: 'Middle value of series' },
  { value: 'constant', label: 'Constant', description: 'Specify fixed value' },
]

/** Selectable fill-strategy cards for the currently active tag in Step 5.2. */
export function ImputationMethodCards({
  value,
  constantValue,
  onChange,
  onConstantChange,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {STRATEGY_CARDS.map(card => {
          const isSelected = value === card.value
          return (
            <button
              key={card.value}
              type="button"
              onClick={() => onChange(card.value)}
              className={cn(
                'group relative rounded-lg border p-3 text-left transition-all',
                isSelected
                  ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                  : 'border-border bg-card hover:border-primary/40 hover:bg-accent',
              )}
            >
              {isSelected && (
                <span className="absolute top-2 right-2 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="h-2.5 w-2.5" strokeWidth={3} />
                </span>
              )}
              <p
                className={cn(
                  'text-sm font-semibold',
                  isSelected ? 'text-primary' : 'text-foreground',
                )}
              >
                {card.label}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {card.description}
              </p>
            </button>
          )
        })}
      </div>

      {value === 'constant' && (
        <div className="flex items-center gap-3 border-t border-border/60 pt-4">
          <Label htmlFor="imputation-constant-value" className="text-sm">
            Value to fill:
          </Label>
          <Input
            id="imputation-constant-value"
            type="number"
            className="h-9 w-32"
            value={constantValue ?? ''}
            onChange={e => {
              const n = Number(e.target.value)
              if (!Number.isNaN(n)) onConstantChange(n)
            }}
          />
        </div>
      )}
    </div>
  )
}
