'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { Button } from '@/components/ui/button'
import type { InputDriftWindow } from '@/services/model-monitoring'
import { formatDriftValue, formatPct, windowTableRows } from '@/lib/input-drift'
import { cn } from '@/lib/utils'

interface Props {
  windows: InputDriftWindow[]
  /** "window" on the scheduled plane, "hour" on the /predict plane. */
  unit: 'window' | 'hour'
}

const PAGE = 24

/** MODEL-SERVE-036. One row per window, newest first — where in time the
 *  out-of-range values arrived. */
export function InputWindowTable({ windows, unit }: Props) {
  const [shown, setShown] = useState(PAGE)
  const rows = windowTableRows(windows)
  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No {unit}s with values in this range.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">
                {unit === 'window' ? 'Window' : 'Hour'}
              </th>
              <th className="px-3 py-2 text-right font-medium">n</th>
              <th className="px-3 py-2 text-right font-medium">Min</th>
              <th className="px-3 py-2 text-right font-medium">Max</th>
              <th className="px-3 py-2 text-right font-medium">Mean</th>
              <th className="px-3 py-2 text-right font-medium">Below</th>
              <th className="px-3 py-2 text-right font-medium">Above</th>
              <th className="px-3 py-2 text-right font-medium">Out of range</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {rows.slice(0, shown).map(r => {
              const out = r.below + r.above > 0
              return (
                <tr key={r.windowStart} className="border-t border-border">
                  <td className="px-3 py-1.5 font-sans whitespace-nowrap">
                    {format(new Date(r.windowStart), 'MMM d, HH:mm')}
                  </td>
                  <td className="px-3 py-1.5 text-right">{r.n}</td>
                  <td className="px-3 py-1.5 text-right">
                    {formatDriftValue(r.min)}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {formatDriftValue(r.max)}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {formatDriftValue(r.mean)}
                  </td>
                  <td
                    className={cn(
                      'px-3 py-1.5 text-right',
                      r.below > 0 ? 'font-medium' : 'text-muted-foreground',
                    )}
                  >
                    {r.below}
                  </td>
                  <td
                    className={cn(
                      'px-3 py-1.5 text-right',
                      r.above > 0 ? 'font-medium' : 'text-muted-foreground',
                    )}
                  >
                    {r.above}
                  </td>
                  <td
                    className={cn(
                      'px-3 py-1.5 text-right',
                      out
                        ? 'font-medium text-chart-4'
                        : 'text-muted-foreground',
                    )}
                  >
                    {formatPct(r.outOfRangePct)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {rows.length > shown && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setShown(s => s + PAGE)}
        >
          Show {Math.min(PAGE, rows.length - shown)} more ({rows.length - shown}{' '}
          left)
        </Button>
      )}
    </div>
  )
}
