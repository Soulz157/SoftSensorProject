'use client'

import { Scissors } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  removedCellItems,
  removedRowItems,
  type PrecleanseRemoved,
} from '@/lib/precleanse'

interface Props {
  removed: PrecleanseRemoved
  keptRows: number
  totalRows: number
}

/**
 * Cut-off Details Summary — what each cut-off stage removed. Reads every
 * counter through removedRowItems/removedCellItems (precleanse.ts) rather
 * than hand-picking fields — that function's own doc comment explains why:
 * a new counter shows up here by construction instead of being silently
 * dropped. A prior hand-rolled version of this list did exactly that, which
 * is why the SD&TA/manual "Excluded ranges" cut never appeared here even
 * though `precleanseBreakdown` was counting it correctly all along.
 *
 * Crop/exclusion/drop-row stages report whole **rows** removed; the
 * value-based outlier rules only touch cells, so they report affected
 * **points**. Styling is intentionally neutral (no red/amber — those are
 * reserved for workspace/plant status per the design system).
 */
export function CutoffSummary({ removed, keptRows, totalRows }: Props) {
  const rows: Array<{ label: string; count: number; unit: string }> = [
    ...removedRowItems(removed).map(item => ({ ...item, unit: 'rows' })),
    ...removedCellItems(removed).map(item => ({ ...item, unit: 'points' })),
  ]

  const keptPct = totalRows > 0 ? (keptRows / totalRows) * 100 : 0

  return (
    <div className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-center gap-2">
        <Scissors className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-medium text-foreground">Cut-off Summary</h3>
      </div>

      <ul className="space-y-1.5">
        {rows.map(r => {
          const active = r.count > 0
          return (
            <li
              key={r.label}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    active ? 'bg-foreground/60' : 'bg-muted-foreground/25',
                  )}
                />
                <span
                  className={cn(
                    active ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  Removed by {r.label}
                </span>
              </span>
              <span
                className={cn(
                  'font-mono tabular-nums',
                  active
                    ? 'font-semibold text-foreground'
                    : 'text-muted-foreground',
                )}
              >
                {r.count} {r.unit}
              </span>
            </li>
          )
        })}
      </ul>

      <div className="space-y-1.5 border-t border-border/60 pt-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Rows kept</span>
          <span className="font-mono font-semibold text-foreground tabular-nums">
            {keptRows} of {totalRows}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${keptPct}%` }}
          />
        </div>
      </div>
    </div>
  )
}
