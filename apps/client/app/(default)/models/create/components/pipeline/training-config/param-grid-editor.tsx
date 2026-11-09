'use client'

import { useId } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { FineTuneParamGrid } from '@/hooks/model/use-fine-tune'
import { formatGridValues, parseGridValues } from '@/lib/param-grid'
import { HYPERPARAMS, type HyperparamField } from '@/lib/training-config'
import {
  ALGORITHM_LABELS,
  type Algorithm,
  type HyperparamValue,
} from '@/store/model-pipeline'

interface Props {
  algorithm: Algorithm
  /** The record the launch sends for the open card; its values are always one
   *  grid point, so a value typed away from it is added back. */
  base: Record<string, HyperparamValue>
  paramGrid: FineTuneParamGrid
}

const NOTE = 'text-[10px] leading-snug text-muted-foreground'

/**
 * MODEL-FLOW-038. Step 3's grid-search editor: one plain text box per searched
 * hyperparameter holding a comma list (`0.1, 1, 10`). Deliberately NOT
 * `<input type="number">` — a number input takes one value, hides a typo behind
 * its spinner, and cannot hold a list. The text is stored as typed
 * (`mpFineTuneParamGridEditsAtom`) and read by `lib/param-grid.ts`; nothing is
 * decided here beyond what to show.
 *
 * The footer states what the search will cost before Start: every combination
 * on every fold. The server re-checks the same limits and is the authority.
 */
export function ParamGridEditor({ algorithm, base, paramGrid }: Props) {
  const idPrefix = useId()
  const { defaults, effective, edits, folds } = paramGrid
  const label = ALGORITHM_LABELS[algorithm]

  if (paramGrid.error) {
    return (
      <p role="status" className={NOTE}>
        Could not load the grid for this algorithm.
      </p>
    )
  }
  if (!defaults || !effective) {
    return (
      <p aria-busy={paramGrid.loading} className={NOTE}>
        Loading the grid…
      </p>
    )
  }

  const fields = HYPERPARAMS[algorithm] ?? []
  const keys = Object.keys(defaults.paramGrid)
  const edited = keys.some(key => key in edits)

  return (
    <div
      role="group"
      aria-label={`${label} grid search`}
      className="mt-3 space-y-2 rounded-md bg-muted/30 px-2.5 py-2.5"
    >
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium">Grid search</span>
        {edited && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={paramGrid.resetEdits}
            className="ml-auto h-6 cursor-pointer gap-1 px-2 text-[10px]"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </Button>
        )}
      </div>
      <p className={NOTE}>
        Every combination of the values below is trained and scored
        {folds > 1
          ? ` on ${folds} cross-validation folds`
          : ' on the test split'}
        ; the best one is kept. Separate values with commas.
      </p>

      <ul className="space-y-2">
        {keys.map(key => {
          const field = fields.find(f => f.key === key)
          const inputId = `${idPrefix}-${key}`
          const hintId = `${inputId}-hint`
          const errors = effective.errors[key]
          const text =
            edits[key] ?? formatGridValues(defaults.paramGrid[key] ?? [])
          const listed =
            edits[key] === undefined
              ? (defaults.paramGrid[key] ?? [])
              : parseGridValues(field, edits[key]).values
          const baseValue = base[key]
          // The base is a grid point whether or not the user listed it.
          const addedBase =
            baseValue !== undefined &&
            !errors &&
            listed.length > 0 &&
            !listed.includes(baseValue)
              ? baseValue
              : undefined

          return (
            <li key={key} className="space-y-0.5">
              <Label htmlFor={inputId} className="text-[11px] font-normal">
                {field?.label ?? key} — values to search
              </Label>
              <Input
                id={inputId}
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={text}
                placeholder="e.g. 0.1, 1, 10"
                aria-invalid={errors ? true : undefined}
                aria-describedby={hintId}
                onChange={e => paramGrid.setEdit(key, e.target.value)}
                className="h-7 font-mono text-[11px]"
              />
              <p
                id={hintId}
                role={errors ? 'alert' : undefined}
                className={
                  errors ? 'text-[10px] leading-snug text-destructive' : NOTE
                }
              >
                {errors
                  ? errors.join('; ')
                  : hintFor(field, effective.grid[key]?.length ?? 0, addedBase)}
              </p>
            </li>
          )
        })}
      </ul>

      <p
        className="text-[11px] text-muted-foreground"
        aria-live="polite"
        data-testid="grid-cost"
      >
        <span className="font-medium text-foreground tabular-nums">
          {paramGrid.combinations ?? 0} combination
          {paramGrid.combinations === 1 ? '' : 's'} × {folds} fold
          {folds === 1 ? '' : 's'} = {paramGrid.fits ?? 0} fits
        </span>
        {defaults.tier !== 'medium' &&
          ` · sized for a ${defaults.tier} dataset`}
      </p>
      {paramGrid.refusal && (
        <p role="alert" className="text-[11px] text-destructive">
          {paramGrid.refusal}
        </p>
      )}
    </div>
  )
}

function hintFor(
  field: HyperparamField | undefined,
  count: number,
  addedBase: HyperparamValue | undefined,
): string {
  const parts: string[] = [`${count} value${count === 1 ? '' : 's'}`]
  if (field?.kind === 'select') {
    parts.push(`options: ${field.options.map(o => o.value).join(', ')}`)
  } else if (field?.kind === 'checkbox') {
    parts.push('true or false')
  } else if (field?.kind === 'nullable-number') {
    parts.push('None = unlimited')
  }
  if (addedBase !== undefined) {
    parts.push(
      `your current ${addedBase === null ? 'None' : String(addedBase)} is always included`,
    )
  }
  return parts.join(' · ')
}
