'use client'

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { ChartLegend } from '@/components/charts/chart-legend'
import { formatCount, formatPct, ingestionChartRows } from '@/lib/data-intake'
import type { IngestionPoint, IntakeRange } from '@/types/data-intake'

const config = {
  scheduledRows: { label: 'Scheduled windows', color: 'var(--chart-1)' },
  predictRows: { label: 'Live predict', color: 'var(--chart-4)' },
} satisfies ChartConfig

const RANGE_NOTE: Record<IntakeRange, string> = {
  '24h': 'hourly',
  '7d': '6-hour buckets',
  '1m': 'daily',
  '1y': 'weekly',
}

/** Bad-cell % travels in the row so the tooltip can show it without a
 *  second axis (a dual axis made the old chart read two stories at once). */
function badPctFrom(
  payload: ReadonlyArray<{ payload?: unknown }> | undefined,
): number | null {
  const row = payload?.[0]?.payload
  if (
    row &&
    typeof row === 'object' &&
    'badCellPct' in row &&
    typeof row.badCellPct === 'number'
  ) {
    return row.badCellPct
  }
  return null
}

export function IngestionChart({
  points,
  range,
}: {
  points: IngestionPoint[]
  range: IntakeRange
}) {
  const rows = ingestionChartRows(points, range)
  const empty = points.every(p => p.scheduledRows + p.predictRows === 0)

  return (
    <section className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-medium">Rows ingested</h2>
          <p className="text-xs text-muted-foreground">
            Last {range}, {RANGE_NOTE[range]}
          </p>
        </div>
        <ChartLegend
          items={[
            {
              shape: 'square',
              color: 'var(--chart-1)',
              label: 'Scheduled windows',
            },
            { shape: 'square', color: 'var(--chart-4)', label: 'Live predict' },
          ]}
        />
      </div>

      {empty ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          No input arrived in this range. Scheduled inference windows and live
          predict calls are counted here.
        </p>
      ) : (
        <ChartContainer config={config} className="h-60 w-full">
          <BarChart
            data={rows}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={24}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={44}
              tickFormatter={(v: number) => formatCount(v)}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(
                    label: unknown,
                    payload: ReadonlyArray<{ payload?: unknown }>,
                  ) =>
                    `${String(label)} · Bad cells ${formatPct(badPctFrom(payload))}`
                  }
                />
              }
            />
            <Bar
              dataKey="scheduledRows"
              stackId="rows"
              fill="var(--color-scheduledRows)"
              maxBarSize={28}
            />
            <Bar
              dataKey="predictRows"
              stackId="rows"
              fill="var(--color-predictRows)"
              radius={[3, 3, 0, 0]}
              maxBarSize={28}
            />
          </BarChart>
        </ChartContainer>
      )}
    </section>
  )
}
