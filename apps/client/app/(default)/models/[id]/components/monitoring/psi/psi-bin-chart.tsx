'use client'

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import type { ColumnBins } from '@/services/model-monitoring'
import { resolvePsiBins, resolvePsiOverflow } from '@/lib/psi-bins'

interface Props {
  bins: ColumnBins
  liveTotal: number
}

interface ChartRow {
  name: string
  reference: number | null
  current: number | null
}

const config = {
  reference: {
    label: 'Reference (training)',
    color: 'var(--muted-foreground)',
  },
  current: { label: 'Current (live)', color: 'var(--chart-1)' },
} satisfies ChartConfig

/**
 * MODEL-SERVE-001-T13/T16, level 2 of T13's own chosen display spec. The
 * repo's first GROUPED (multi-series) bar chart — every existing `<Bar>`
 * here renders a single series, so this is built on `ChartContainer`'s
 * token-driven pattern (`ingestion-trend-chart.tsx`), never on
 * `residual-histogram-chart.tsx`, which hardcodes a hex fill and would
 * spend DESIGN.md's reserved Warning Amber on a non-status mark.
 *
 * Bin labels are bare (`B1`..`B10`, `<lo`/`>hi`) DELIBERATELY — the
 * sibling `PsiBinTable` rendered beside this chart carries the real
 * engineering-unit ranges; T13's own "bare B1..B10 labels tell a process
 * engineer nothing" is the reason that table exists, not a reason to widen
 * this chart's axis labels.
 *
 * `<lo`/`>hi` render as FLANKING bars, separated from the frozen bins by a
 * blank category (a `null`-valued row draws no bar but still reserves the
 * axis slot) — reference is 0% there BY CONSTRUCTION, since every training
 * value sits inside its own derived edges. Omitted entirely for a
 * categorical tag (`resolvePsiOverflow` returns `null`): that bucketing has
 * no "out of range" concept, so a flanking bar would be noise.
 *
 * NO STATUS COLORS in the bars — red/amber/purple are reserved operating-
 * state infrastructure (DESIGN.md), and this signal already opts out of
 * that vocabulary (`drift-status-style.ts`'s own rationale). Status stays
 * in the summary card's badge; these bars use chart tokens only.
 */
export function PsiBinChart({ bins, liveTotal }: Props) {
  const binRows = resolvePsiBins(bins)
  const overflow = resolvePsiOverflow(bins, liveTotal)

  const data: ChartRow[] = []
  if (overflow) {
    data.push({
      name: overflow.below.label,
      reference: 0,
      current: overflow.below.curPct,
    })
    data.push({ name: '', reference: null, current: null })
  }
  for (const row of binRows) {
    data.push({ name: row.label, reference: row.refPct, current: row.curPct })
  }
  if (overflow) {
    data.push({ name: '', reference: null, current: null })
    data.push({
      name: overflow.above.label,
      reference: 0,
      current: overflow.above.curPct,
    })
  }

  return (
    <div className="space-y-1.5">
      <ChartContainer config={config} className="h-64 w-full">
        <BarChart
          data={data}
          margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="name"
            tickLine={false}
            axisLine={false}
            interval={0}
            tick={{ fontSize: 10 }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={36}
            tickFormatter={v => `${v}%`}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar
            dataKey="reference"
            fill="var(--color-reference)"
            radius={[2, 2, 0, 0]}
          />
          <Bar
            dataKey="current"
            fill="var(--color-current)"
            radius={[2, 2, 0, 0]}
          />
        </BarChart>
      </ChartContainer>
      {/* T13's drill-down rationale ("every reference bar sits at exactly
          100/bin_count percent") holds for CONTINUOUS bins only —
          `psi.py`'s own module docstring: a categorical split is not
          equal-frequency (a valve closed 90% of the time has a real 90/10
          reference split). Shown only where it is actually true. */}
      {bins.binMode === 'continuous' && (
        <p className="text-[10px] text-muted-foreground/70">
          Reference is flat at {(100 / bins.binCount).toFixed(1)}% per bin by
          construction (equal-frequency quantile bins) — deviation in Current is
          the signal.
        </p>
      )}
    </div>
  )
}
