'use client'

import { Info } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { ColumnBins } from '@/services/model-monitoring'
import { resolvePsiBins, resolvePsiOverflow } from '@/lib/psi-bins'

interface Props {
  bins: ColumnBins
  liveTotal: number
}

/**
 * MODEL-SERVE-001-T13/T16, level 3 of T13's own chosen display spec —
 * NOT OPTIONAL: "bare B1..B10 labels tell a process engineer nothing …
 * the entire value of PSI over a z-score is knowing WHERE in the range
 * the distribution moved." `resolvePsiBins`/`resolvePsiOverflow`
 * (`lib/psi-bins.ts`) already branch on `binMode` for edge semantics — this
 * component only renders their result, never re-derives a range itself.
 *
 * Overflow rows (continuous only) are visually set apart (`bg-muted/10`)
 * and their own footnote states the DIFFERENT denominator explicitly:
 * `liveTotal` (the column's full population) for `<lo`/`>hi`, vs.
 * `liveInRangeTotal` (bins only) for every bin row — the two must never be
 * silently mixed into one implied percentage base.
 *
 * The `Ref count` header carries its own tooltip. Reference counts are FLAT
 * for a continuous tag — `quantile_edges`
 * (packages/py-scaling/src/softsensor_scaling/psi.py) cuts bins at equal
 * training population, so equal counts are the definition, not a symptom —
 * and every tag binned from the same TRAIN split shows the same numbers,
 * which reads as "the table is broken" to anyone who has not seen that
 * function. The copy branches on `binMode` because the quantile claim is
 * simply false for a categorical tag, whose counts are real per-value
 * frequencies and legitimately uneven.
 */
export function PsiBinTable({ bins, liveTotal }: Props) {
  const rows = resolvePsiBins(bins)
  const overflow = resolvePsiOverflow(bins, liveTotal)

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Bin</th>
            <th className="px-3 py-2 text-left font-medium">Range</th>
            <th className="px-3 py-2 text-right font-medium">Reference %</th>
            <th className="px-3 py-2 text-right font-medium">Current %</th>
            <th className="px-3 py-2 text-right font-medium">
              {/* The reference column is FLAT BY CONSTRUCTION, which reads
                  as a bug to anyone who has not seen `quantile_edges`
                  (packages/py-scaling/src/softsensor_scaling/psi.py). The
                  note lives on the header rather than in the footnote
                  below because the question ("why is every number the
                  same?") is asked while looking at THIS column, and the
                  footnote is already carrying the two-denominators
                  explanation — a second paragraph there would bury both. */}
              <TooltipProvider delayDuration={100}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={e => e.stopPropagation()}
                      className="inline-flex cursor-help items-center gap-1 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      Ref count
                      <Info className="h-3 w-3 opacity-60" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="grid max-w-xs space-y-1.5 text-left">
                    {bins.binMode === 'categorical' ? (
                      <p className="text-xs leading-snug">
                        Real per-value frequencies from the training split —
                        this tag has too few distinct values to bin by quantile,
                        so one bin is one value and these counts are genuinely
                        uneven.
                      </p>
                    ) : (
                      <p className="text-xs leading-snug">
                        Equal on purpose. These are{' '}
                        <span className="font-medium">quantile</span> bins cut
                        from the training split, so each holds the same share of
                        training rows by definition — Reference % sits near{' '}
                        {(100 / Math.max(rows.length, 1)).toFixed(1)}% for the
                        same reason.
                      </p>
                    )}
                    <p className="text-xs leading-snug opacity-80">
                      Either way the reference is frozen at training time and
                      never re-fit, so the signal is Current moving away from it
                      — not this column changing.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </th>
            <th className="px-3 py-2 text-right font-medium">Cur count</th>
          </tr>
        </thead>
        <tbody>
          {overflow && (
            <tr className="border-t border-border bg-muted/10">
              <td className="px-3 py-2 font-mono">{overflow.below.label}</td>
              <td className="px-3 py-2 text-muted-foreground">
                below trained range
              </td>
              <td className="px-3 py-2 text-right font-mono">0.0%</td>
              <td className="px-3 py-2 text-right font-mono">
                {overflow.below.curPct.toFixed(1)}%
              </td>
              <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                —
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {overflow.below.curCount}
              </td>
            </tr>
          )}
          {rows.map(row => (
            <tr key={row.key} className="border-t border-border">
              <td className="px-3 py-2 font-mono">{row.label}</td>
              <td className="px-3 py-2 font-mono text-muted-foreground">
                {row.rangeLabel}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {row.refPct.toFixed(1)}%
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {row.curPct.toFixed(1)}%
              </td>
              <td className="px-3 py-2 text-right font-mono">{row.refCount}</td>
              <td className="px-3 py-2 text-right font-mono">{row.curCount}</td>
            </tr>
          ))}
          {overflow && (
            <tr className="border-t border-border bg-muted/10">
              <td className="px-3 py-2 font-mono">{overflow.above.label}</td>
              <td className="px-3 py-2 text-muted-foreground">
                above trained range
              </td>
              <td className="px-3 py-2 text-right font-mono">0.0%</td>
              <td className="px-3 py-2 text-right font-mono">
                {overflow.above.curPct.toFixed(1)}%
              </td>
              <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                —
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {overflow.above.curCount}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="border-t border-border px-3 py-2 text-[10px] text-muted-foreground/70">
        {overflow
          ? `Overflow rows (<lo/>hi) are a percentage of all ${liveTotal} live rows. Bin rows are a percentage of the ${bins.liveInRangeTotal} rows that fell inside the trained range — the two denominators differ.`
          : `Percentages are of the ${bins.liveInRangeTotal} live rows for this categorical tag.`}
      </p>
    </div>
  )
}
