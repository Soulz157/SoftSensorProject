'use client'

import { Sparkles } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface Props {
  findBestModel: boolean
  onFindBestModel: (on: boolean) => void
  findBestParams: boolean
  onFindBestParams: (on: boolean) => void
}

interface RowProps {
  step: number
  title: string
  description: string
  checked: boolean
  disabled?: boolean
  onChange: (on: boolean) => void
  nested?: boolean
}

function ToggleRow({
  step,
  title,
  description,
  checked,
  disabled,
  onChange,
  nested,
}: RowProps) {
  const id = `automl-step-${step}`
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border p-3 transition-colors',
        nested && 'ml-4 border-l-2 border-l-primary/30',
        disabled ? 'opacity-50' : 'border-border',
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
          checked
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground',
        )}
      >
        {step}
      </span>
      <div className="min-w-0 flex-1">
        <Label htmlFor={id} className="text-sm font-medium">
          {title}
        </Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  )
}

/**
 * Sequential AutoML pipeline: Step A picks the best algorithm, then Step B
 * (only available once A is on) tunes its hyperparameters. Ordered 1 → 2.
 */
export function AutoMlToggles({
  findBestModel,
  onFindBestModel,
  findBestParams,
  onFindBestParams,
}: Props) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-medium text-foreground">
          Automated tuning
        </h3>
      </div>
      <div className="space-y-2">
        <ToggleRow
          step={1}
          title="Find Best Model"
          description="Evaluate the selected algorithms and automatically pick the best one."
          checked={findBestModel}
          onChange={onFindBestModel}
        />
        <ToggleRow
          step={2}
          nested
          title="Find Best Parameters"
          description="Hyperparameter-tune the best model. Requires Find Best Model."
          checked={findBestParams}
          disabled={!findBestModel}
          onChange={onFindBestParams}
        />
      </div>
    </div>
  )
}
