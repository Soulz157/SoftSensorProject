import { summaryCells } from '@/lib/data-intake'
import type { IntakeTotals } from '@/types/data-intake'

/** The figures behind the page, in one grid. Same stat-cell pattern as the
 *  Monitoring tab's input-drift stats, with labels in sentence case. */
export function IntakeSummary({ totals }: { totals: IntakeTotals }) {
  const cells = summaryCells(totals)
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border ring-1 ring-foreground/10 lg:grid-cols-6">
      {cells.map(cell => (
        <div key={cell.key} className="bg-card px-4 py-3">
          <dt className="text-xs font-medium text-muted-foreground">
            {cell.label}
          </dt>
          <dd className="mt-1 font-mono text-xl font-semibold tabular-nums text-foreground">
            {cell.value}
          </dd>
          {cell.hint && (
            <dd className="mt-0.5 text-xs text-muted-foreground">
              {cell.hint}
            </dd>
          )}
        </div>
      ))}
    </dl>
  )
}
