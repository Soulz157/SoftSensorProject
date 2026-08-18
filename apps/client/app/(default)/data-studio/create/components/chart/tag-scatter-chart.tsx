'use client'

import {
  CartesianGrid,
  ReferenceLine,
  Scatter,
  ScatterChart as RechartsScatterChart,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import { ScatterChart as ScatterIcon } from 'lucide-react'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { regressionSegment } from '@/lib/preprocessing'
import { tagMeta } from '@/lib/mock-readings'
import type { DraftScatterResult } from '@/services/dataset-draft'

/**
 * DS-LAKE-005B-D-T04. Consumes the SERVER scatter response — the decimated
 * point cloud and regression coefficients are computed by
 * `scatter_service.py`, not this component. `Dataset` is deliberately NOT
 * accepted here (same DS-LAKE-005B-D-V05 type gate `TagHistogramChart`/
 * `TagBoxplotChart` apply).
 *
 * SIMPLIFICATION vs the client-only `ScatterRegressionChart` this replaces
 * in Step 3.1: X/Y tag selection is NOT owned by this component (no
 * internal `<Select>`), matching `TagHistogramChart`/`TagBoxplotChart`'s
 * own pattern — tag selection lives in the PARENT via the existing
 * `compareTags`/`focusedTag` state (`useCompareTags`), not a second picker.
 * The old component's correlation-based X auto-default (`pearsonMatrix`)
 * is dropped for the same reason: it needs the full client frame, which
 * this component's whole point is to not require. Not a silent narrowing —
 * recorded here and in this task's own `result`.
 *
 * `status` mirrors `TagHistogramChart`/`TagBoxplotChart`'s exact union.
 */
interface Props {
  data: DraftScatterResult | null
  xTag: string
  yTag: string
  status: 'no-tags' | 'pending' | 'loading' | 'ready'
}

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export function TagScatterChart({ data, xTag, yTag, status }: Props) {
  const xMeta = tagMeta(xTag)
  const yMeta = tagMeta(yTag)

  const config: ChartConfig = {
    x: { label: xMeta?.label ?? xTag, color: 'var(--chart-2)' },
    y: { label: yMeta?.label ?? yTag, color: 'var(--chart-2)' },
  }

  if (status === 'no-tags') {
    return (
      <div className="flex h-80 flex-col items-center justify-center gap-2 text-center">
        <ScatterIcon className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          Select an X and a Y tag above.
        </p>
      </div>
    )
  }

  if (status === 'pending') {
    return (
      <div className="flex h-80 flex-col items-center justify-center gap-2 text-center">
        <ScatterIcon className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          Save cleaned tags to build a scatter plot.
        </p>
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <div className="flex h-80 flex-col items-center justify-center gap-2 text-center">
        <ScatterIcon className="h-8 w-8 animate-pulse text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Loading scatter plot…</p>
      </div>
    )
  }

  if (!data || data.n < 2) {
    return (
      <div className="flex h-80 flex-col items-center justify-center gap-2 text-center">
        <ScatterIcon className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          Not enough paired values for{' '}
          <span className="font-mono">
            {xTag}, {yTag}
          </span>
        </p>
      </div>
    )
  }

  const segment =
    data.points.length >= 2
      ? regressionSegment(data.points, data.slope, data.intercept)
      : null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3 font-mono text-xs text-muted-foreground">
          <span>
            X <span className="text-foreground">{xMeta?.label ?? xTag}</span>
          </span>
          <span>
            Y <span className="text-foreground">{yMeta?.label ?? yTag}</span>
          </span>
        </div>
        <div className="rounded-md bg-muted px-2.5 py-1 font-mono text-xs text-foreground">
          y = {fmt(data.slope)}x + {fmt(data.intercept)} · R² ={' '}
          {data.r2.toFixed(3)}
          {data.downsampled && (
            <span className="ml-1.5 text-muted-foreground">
              ({data.points.length.toLocaleString()} of{' '}
              {data.n.toLocaleString()} shown; fit uses all{' '}
              {data.n.toLocaleString()})
            </span>
          )}
        </div>
      </div>

      <ChartContainer config={config} className="h-80 w-full">
        <RechartsScatterChart
          margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
        >
          <CartesianGrid />
          <XAxis
            type="number"
            dataKey="x"
            name={xMeta?.label ?? xTag}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={fmt}
            domain={['auto', 'auto']}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={yMeta?.label ?? yTag}
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={fmt}
            domain={['auto', 'auto']}
          />
          <ZAxis range={[50, 50]} />
          <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
          <Scatter
            data={data.points}
            fill="var(--chart-2)"
            isAnimationActive={false}
          />
          {segment && (
            <ReferenceLine
              ifOverflow="extendDomain"
              segment={segment}
              stroke="var(--chart-1)"
              strokeWidth={2}
              strokeDasharray="6 4"
            />
          )}
        </RechartsScatterChart>
      </ChartContainer>
    </div>
  )
}
