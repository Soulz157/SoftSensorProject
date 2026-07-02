'use client'

import { GitCompareArrows } from 'lucide-react'
import type { Dataset } from '@/lib/preprocessing'
import { CorrelationMatrix } from '../../chart/correlation-matrix'

interface Props {
  /** Live pre-cleansed dataset. */
  dataset: Dataset
}

/**
 * Step 5.1 correlation heatmap — wraps the reused `CorrelationMatrix` with a
 * titled card + color legend so the user can read tag relationships before
 * imputing in 5.2.
 *
 * Color scale: emerald = positive, sky = negative (NOT the request's blue/red —
 * DESIGN.md reserves status-red for alarms, so we keep the established
 * `CorrelationMatrix` scale and label it here).
 */
export function CorrelationHeatmap({ dataset }: Props) {
  if (dataset.tags.length < 2) return null

  return (
    <div className="space-y-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <GitCompareArrows className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">
            Correlation Matrix
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500/70" />
            Positive
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-sky-500/70" />
            Negative
          </span>
          <span className="font-mono">Pearson r</span>
        </div>
      </div>

      <CorrelationMatrix dataset={dataset} />
    </div>
  )
}
