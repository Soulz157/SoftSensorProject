'use client'

import { useEffect, useState } from 'react'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import type { EvalPoint } from '@/lib/model-evaluation'

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

const config: ChartConfig = {
  actual: { label: 'Lab (actual)', color: 'var(--color-chart-1)' },
  predicted: { label: 'Predicted', color: 'var(--color-chart-2)' },
}

const fmt = (v: number) =>
  v.toLocaleString(undefined, { maximumFractionDigits: 2 })

export function EvaluationChart({ points }: { points: EvalPoint[] }) {
  const reduced = usePrefersReducedMotion()

  if (points.length === 0) {
    return (
      <div className="flex h-80 items-center justify-center text-sm text-muted-foreground">
        No comparison data available
      </div>
    )
  }

  const data = points.map(p => ({
    t: new Date(p.timestamp).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
    }),
    actual: p.actual,
    predicted: p.predicted,
  }))

  return (
    <ChartContainer config={config} className="h-80 w-full">
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="t"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={32}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={48}
          tickFormatter={fmt}
          domain={['auto', 'auto']}
        />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Line
          dataKey="actual"
          type="monotone"
          stroke="var(--color-actual)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={!reduced}
        />
        <Line
          dataKey="predicted"
          type="monotone"
          stroke="var(--color-predicted)"
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={false}
          isAnimationActive={!reduced}
        />
      </LineChart>
    </ChartContainer>
  )
}
