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
            <th className="px-3 py-2 text-right font-medium">Ref count</th>
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
