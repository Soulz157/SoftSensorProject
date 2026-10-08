'use client'

import { useEffect, useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { LineChart } from 'lucide-react'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { cn } from '@/lib/utils'
import {
  rangeConfig,
  tagMeta,
  chartColorVar,
  type TimeRange,
} from '@/lib/mock-readings'
import type { SensorChartRow } from '@/hooks/use-sensor-readings'

interface Props {
  rows: SensorChartRow[]
  tags: string[]
  range: TimeRange
  dimmed?: boolean
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return reduced
}

export function SensorTrendChart({ rows, tags, range, dimmed }: Props) {
  const reducedMotion = usePrefersReducedMotion()
  const { tickFormat } = rangeConfig(range)

  const config = useMemo<ChartConfig>(() => {
    const entries = tags.map(piTag => {
      const meta = tagMeta(piTag)
      return [
        piTag,
        {
          label: meta?.label ?? piTag,
          color: chartColorVar(meta?.chartIndex ?? 1),
        },
      ] as const
    })
    return Object.fromEntries(entries)
  }, [tags])

  if (tags.length === 0) {
    return (
      <div className="flex h-80 flex-col items-center justify-center gap-2 text-center">
        <LineChart className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          Select one or more PI tags to plot
        </p>
      </div>
    )
  }

  return (
    <ChartContainer
      config={config}
      className={cn('h-80 w-full', dimmed && 'opacity-60 transition-opacity')}
    >
      <AreaChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="timestamp"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={32}
          tickFormatter={value => tickFormat(String(value))}
        />
        <YAxis tickLine={false} axisLine={false} width={44} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={value => new Date(String(value)).toLocaleString()}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        {tags.map(piTag => (
          <Area
            key={piTag}
            dataKey={piTag}
            type="monotone"
            stroke={`var(--color-${piTag})`}
            fill={`var(--color-${piTag})`}
            fillOpacity={0.12}
            strokeWidth={2}
            dot={false}
            connectNulls
            isAnimationActive={!reducedMotion}
          />
        ))}
      </AreaChart>
    </ChartContainer>
  )
}
