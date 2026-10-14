'use client'

import { Sparkles } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import type { Algorithm } from '@/store/model-pipeline'

interface Props {
  findBestParams: boolean
  onFindBestParams: (on: boolean) => void
  /** Cross-Validation on — only reachable with one algorithm, where every
   *  variant is cross-validated (MODEL-FLOW-029). */
  cvEnabled: boolean
  /** One algorithm: search the curated grid for it (HYPERPARAMETER_SEARCH).
   *  Two or more: train them all, then tune whichever wins on Test RMSE
   *  (SWEEP_THEN_TUNE). Find Best Model was removed 2026-10-14 — comparing
   *  several algorithms is the default, and Step 4 recommends the best. */
  algorithms: Algorithm[]
}

interface RowProps {
  title: string
  description: string
  checked: boolean
  onChange: (on: boolean) => void
}

function ToggleRow({ title, description, checked, onChange }: RowProps) {
  const id = 'automl-find-best-params'
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border p-3">
      <div className="min-w-0 flex-1">
        <Label htmlFor={id} className="text-sm font-medium">
          {title}
        </Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

/**
 * Find Best Parameters, on its own. What it tunes follows from how many
 * algorithms are selected, so the row says which case applies.
 */
export function AutoMlToggles({
  findBestParams,
  onFindBestParams,
  cvEnabled,
  algorithms,
}: Props) {
  const singleAlgorithm = algorithms.length === 1
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-medium text-foreground">
          Automated tuning
        </h3>
      </div>
      <ToggleRow
        title="Find Best Parameters"
        description={
          singleAlgorithm
            ? cvEnabled
              ? // MODEL-FLOW-029. CV composes with a direct search: every
                // variant is cross-validated and the winner is the lowest
                // mean CV RMSE. The fit count is in the runtime estimate.
                'Also try a curated set of hyperparameter variants for this algorithm — every variant is cross-validated (k+1 fits each) and the lowest mean CV RMSE wins.'
              : 'Also try a curated set of hyperparameter variants for this algorithm.'
            : 'After every algorithm trains, tune the one with the lowest Test RMSE with a curated set of hyperparameter variants.'
        }
        checked={findBestParams}
        onChange={onFindBestParams}
      />
    </div>
  )
}
