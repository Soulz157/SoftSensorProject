'use client'

import { useEffect, useState } from 'react'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import { tuningGridService } from '@/services/tuning-grid'

/**
 * MODEL-SERVE-014. Was a 5-value algorithm picker + testSplit slider over a
 * client-invented `RegressionModel`/`RetrainConfig` — neither survives
 * against the real backend contract: `TriggerRetrainSchema` reads split off
 * the incumbent server-side (never accepted from the request), and the real
 * `TrainingAlgorithmEnum` has 12 values, not 5. A retrain candidate's
 * algorithm is pinned to the incumbent's own (the comparison this feature
 * publishes needs a shared basis) — so "Custom" now means picking ONE of
 * the incumbent algorithm's own curated hyperparameter variants
 * (`tuningGridService`, the SAME shortlist Find Best Parameters searches —
 * never a second copy declared client-side), not typing raw numbers with no
 * real range metadata behind them.
 */
export function CustomFinetuneForm({
  algorithm,
  hyperparameters,
  onChange,
  disabled,
}: {
  /** The incumbent PRODUCTION version's algorithm — null while it has not
   *  loaded yet (`useModelRetrain().incumbent`). */
  algorithm: string | null
  hyperparameters: Record<string, unknown> | null
  onChange: (hyperparameters: Record<string, unknown>) => void
  disabled?: boolean
}) {
  const [variants, setVariants] = useState<
    Array<Record<string, string | number | boolean | null>>
  >([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!algorithm) {
      setVariants([])
      return
    }
    let ignore = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        // Unwrapped — this endpoint returns the DTO directly, with no
        // `{data}` envelope (see `tuningGridService`'s own note).
        const grid = await tuningGridService.get(algorithm)
        if (ignore) return
        setVariants(grid.variants)
        // Default to the first variant so the dialog's submit button is
        // immediately actionable rather than starting on an empty selection.
        if (grid.variants.length > 0 && !hyperparameters) {
          onChange(grid.variants[0]!)
        }
      } catch (err) {
        if (ignore) return
        // The server's OWN message (e.g. 'No tuning grid for "lstm" — it may
        // not support Find Best Parameters.'), never a generic line that
        // hides which of several causes actually fired — the same mistake
        // the no-PRODUCTION-version banner made before it was corrected.
        setError(
          err instanceof Error
            ? err.message
            : 'Could not load hyperparameter variants for this algorithm',
        )
      } finally {
        if (!ignore) setLoading(false)
      }
    })()
    return () => {
      ignore = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [algorithm])

  if (!algorithm) {
    return (
      <p className="text-sm text-muted-foreground">
        Waiting for the current production version…
      </p>
    )
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>
  }

  if (variants.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No curated hyperparameter variants exist for {algorithm} yet — use
        Auto Finetune instead.
      </p>
    )
  }

  const selectedIndex = hyperparameters
    ? variants.findIndex(
        v => JSON.stringify(v) === JSON.stringify(hyperparameters),
      )
    : -1

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>Algorithm</Label>
        <p className="text-sm text-muted-foreground">{algorithm}</p>
      </div>

      <div className="space-y-1.5">
        <Label>Hyperparameter variant</Label>
        <RadioGroup
          value={selectedIndex >= 0 ? String(selectedIndex) : undefined}
          onValueChange={v => {
            const variant = variants[Number(v)]
            if (variant) onChange(variant)
          }}
          disabled={disabled}
        >
          {variants.map((variant, i) => (
            <label
              key={i}
              className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-2.5 text-xs has-[[data-checked]]:border-primary has-[[data-checked]]:bg-primary/5"
            >
              <RadioGroupItem value={String(i)} className="mt-0.5" />
              <span className="font-mono text-[11px] leading-relaxed text-muted-foreground">
                {Object.entries(variant)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(', ')}
              </span>
            </label>
          ))}
        </RadioGroup>
      </div>
    </div>
  )
}
