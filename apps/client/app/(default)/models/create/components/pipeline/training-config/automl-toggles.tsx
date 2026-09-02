'use client'

import { Sparkles } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { Algorithm } from '@/store/model-pipeline'

interface Props {
  findBestModel: boolean
  onFindBestModel: (on: boolean) => void
  findBestParams: boolean
  onFindBestParams: (on: boolean) => void
  /** MODEL-FLOW-016. userDecisions: CV × algorithm sweep is mutually
   * exclusive — a CV run fits one algorithm's k folds, a sweep evaluates
   * several algorithms; the two answer different questions and neither's
   * result composes with the other's. Same disable+swapped-description
   * pattern this file already uses for Find Best Parameters. */
  cvEnabled: boolean
  /** Find Best Parameters is enabled either via Find Best Model's sweep
   * (tunes the winner) OR directly when exactly one algorithm is selected
   * (a HYPERPARAMETER_SEARCH job — one algorithm, N curated hyperparameter
   * variants, no sweep needed since there is only one candidate to begin
   * with). */
  algorithms: Algorithm[]
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
  cvEnabled,
  algorithms,
}: Props) {
  const singleAlgorithm = algorithms.length === 1
  const findBestParamsEnabled = findBestModel || singleAlgorithm
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
          description={
            cvEnabled
              ? 'Turn off Cross-Validation first — a sweep evaluates several algorithms, CV fits one.'
              : 'Evaluate the selected algorithms and automatically pick the best one.'
          }
          checked={findBestModel}
          disabled={cvEnabled}
          onChange={onFindBestModel}
        />
        <ToggleRow
          step={2}
          nested
          title="Find Best Parameters"
          // MODEL-FLOW-013-T11 / [fix]. Two ways in: tunes phase 1's
          // sweep-winner via a curated hyperparameter shortlist
          // (apps/backend/src/lib/tuning-grid.ts), appended server-side
          // once the sweep exhausts — OR, with exactly one algorithm
          // selected and no sweep, tunes THAT algorithm directly
          // (HYPERPARAMETER_SEARCH — same curated shortlist, expanded
          // server-side from the one candidate, no sweep needed since
          // there's only one candidate to begin with). Disabled only when
          // neither applies: Find Best Model is off AND more/fewer than
          // one algorithm is selected.
          description={
            findBestModel
              ? 'Tune the sweep’s winning algorithm with a curated set of hyperparameter variants.'
              : singleAlgorithm
                ? 'Tune this algorithm’s hyperparameters directly — no sweep needed with one algorithm selected.'
                : 'Turn on Find Best Model first, or select exactly one algorithm to tune it directly.'
          }
          checked={findBestParams}
          disabled={!findBestParamsEnabled}
          onChange={onFindBestParams}
        />
      </div>
    </div>
  )
}
