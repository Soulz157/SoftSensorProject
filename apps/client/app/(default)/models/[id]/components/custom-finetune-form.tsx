'use client'

import { useEffect, useState } from 'react'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { tuningGridService } from '@/services/tuning-grid'
import { isAlgorithm } from '@/lib/model-draft-hydration'
import {
  finetuneStartingHyperparams,
  variantAsHyperparams,
} from '@/lib/retrain-finetune'
import { ALGORITHM_LABELS, type HyperparamValue } from '@/store/model-pipeline'
import { DynamicHyperparameters } from '@/app/(default)/models/create/components/pipeline/training-config/dynamic-hyperparameters'
import { TrainTestSplit } from '@/app/(default)/models/create/components/pipeline/training-config/core-config'

/**
 * Custom Finetune: the model wizard's own train/test split control and
 * hyperparameter table, reused as-is, for the current version's algorithm.
 *
 * The algorithm stays pinned to the current version's — the comparison this
 * retrain publishes needs a shared basis. The table opens on the current
 * version's own hyperparameters (over the full defaults), and the curated
 * variants Find Best Parameters searches (`tuningGridService`, sized to this
 * model via `modelId`) are offered as a "Fill from" shortcut above it rather
 * than as the only choices.
 *
 * The split is safe to change here: neither new-data strategy compares on it
 * (Existing + new data is scored on the current version's frozen test rows,
 * New data only on the validation window), so it only decides how much of
 * the training data is held back as this candidate's own test set.
 */
export function CustomFinetuneForm({
  algorithm,
  incumbentHyperparameters,
  hyperparameters,
  onChange,
  trainSplit,
  onTrainSplitChange,
  disabled,
  modelId,
}: {
  /** The current PRODUCTION version's algorithm — null while it has not
   *  loaded yet (`useModelRetrain().incumbent`). */
  algorithm: string | null
  /** The current version's own hyperparameters, the table's starting point. */
  incumbentHyperparameters: Record<string, unknown> | null
  hyperparameters: Record<string, HyperparamValue> | null
  onChange: (hyperparameters: Record<string, HyperparamValue>) => void
  /** Train share as a percent (50–95), the wizard control's own unit. */
  trainSplit: number
  onTrainSplitChange: (percent: number) => void
  disabled?: boolean
  /** MODEL-FLOW-024. Sizes the curated variants to this model's own data. */
  modelId?: string
}) {
  const knownAlgorithm = algorithm && isAlgorithm(algorithm) ? algorithm : null
  const [variants, setVariants] = useState<
    Array<Record<string, HyperparamValue>>
  >([])
  const [variantsError, setVariantsError] = useState<string | null>(null)
  const [sized, setSized] = useState(false)

  // Opens on the current version's own values — once, the first time the
  // algorithm is known, so an operator's edits are never overwritten.
  useEffect(() => {
    if (knownAlgorithm && !hyperparameters) {
      onChange(
        finetuneStartingHyperparams(knownAlgorithm, incumbentHyperparameters),
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knownAlgorithm])

  useEffect(() => {
    if (!knownAlgorithm) return
    let ignore = false
    void (async () => {
      try {
        // Unwrapped — this endpoint returns the DTO directly, with no
        // `{data}` envelope (see `tuningGridService`'s own note).
        const grid = await tuningGridService.get(
          knownAlgorithm,
          undefined,
          modelId,
        )
        if (ignore) return
        setVariants(grid.variants)
        setSized(grid.sized)
      } catch (err) {
        // The shortcut is optional — the table works without it — so its
        // failure is stated beside it, never in place of the form.
        if (!ignore)
          setVariantsError(
            err instanceof Error ? err.message : 'Could not load variants',
          )
      }
    })()
    return () => {
      ignore = true
    }
  }, [knownAlgorithm, modelId])

  if (!algorithm) {
    return (
      <p className="text-sm text-muted-foreground">
        Waiting for the current production version…
      </p>
    )
  }

  if (!knownAlgorithm) {
    return (
      <p className="text-sm text-muted-foreground">
        {algorithm} has no editable hyperparameters here — use Auto Finetune
        instead.
      </p>
    )
  }

  return (
    // A native fieldset disables every control inside it — inputs, checkboxes
    // and the select triggers — without the shared table growing a prop.
    <fieldset disabled={disabled} className="min-w-0 space-y-4">
      <div className="space-y-1">
        <Label>Algorithm</Label>
        <p className="text-sm text-muted-foreground">
          {ALGORITHM_LABELS[knownAlgorithm]} · same as the current version
        </p>
      </div>

      <TrainTestSplit
        trainTestSplit={trainSplit}
        onSplitChange={onTrainSplitChange}
      />

      <div className="space-y-1.5">
        <Label className="text-xs font-medium">Fill from a variant</Label>
        {/* MODEL-FLOW-024. Said only when the list really differs from the
            general one (`sized`, read off array identity server-side). */}
        {sized && (
          <p className="text-[10px] leading-tight text-muted-foreground">
            Sized to this model’s own data, so these differ from the general
            list.
          </p>
        )}
        {variantsError ? (
          <p className="text-xs text-muted-foreground">{variantsError}</p>
        ) : (
          <Select
            value=""
            onValueChange={v => {
              const variant = variants[Number(v)]
              if (variant)
                onChange(variantAsHyperparams(knownAlgorithm, variant))
            }}
            disabled={disabled || variants.length === 0}
          >
            <SelectTrigger className="h-9 w-full text-xs">
              <SelectValue
                placeholder={
                  variants.length === 0
                    ? 'No curated variants'
                    : 'Pick one to fill the table below'
                }
              />
            </SelectTrigger>
            <SelectContent>
              {variants.map((variant, i) => (
                <SelectItem key={i} value={String(i)}>
                  <span className="font-mono text-[11px]">
                    {Object.entries(variant)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(', ')}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {hyperparameters && (
        <DynamicHyperparameters
          algorithm={knownAlgorithm}
          hyperparameters={hyperparameters}
          onChange={(key, value) =>
            onChange({ ...hyperparameters, [key]: value })
          }
        />
      )}
    </fieldset>
  )
}
