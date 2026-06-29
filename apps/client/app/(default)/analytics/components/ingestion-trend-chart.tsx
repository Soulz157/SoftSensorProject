'use client'

import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import type { IngestionPoint } from '@/lib/pipeline-metrics'
import type { TimeRange } from '@/lib/mock-readings'

interface Props {
  data: IngestionPoint[]
  range: TimeRange
}

const config = {
  volume: { label: 'Data Volume (k)', color: 'var(--chart-1)' },
  successRate: { label: 'Batch Success %', color: 'var(--chart-2)' },
} satisfies ChartConfig

export function IngestionTrendChart({ data, range }: Props) {
  return (
    <Card className="bg-card border-border lg:col-span-2">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">
          Data Ingestion Trend
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Volume & batch fetch success over {range}
        </p>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="h-55 w-full">
          <ComposedChart
            data={data}
            margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
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
              yAxisId="left"
              tickLine={false}
              axisLine={false}
              width={36}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={[90, 100]}
              tickLine={false}
              axisLine={false}
              width={36}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar
              yAxisId="left"
              dataKey="volume"
              fill="var(--color-volume)"
              radius={[3, 3, 0, 0]}
              maxBarSize={28}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="successRate"
              stroke="var(--color-successRate)"
              strokeWidth={2}
              dot={false}
            />
          </ComposedChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
