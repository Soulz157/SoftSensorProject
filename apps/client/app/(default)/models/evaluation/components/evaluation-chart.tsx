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
import type { PredPoint } from '@/lib/mock-lab-data'
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
  predicted: { label: 'Predicted', color: 'var(--color-chart-2)' },
  actual: { label: 'Lab (actual)', color: 'var(--color-chart-1)' },
}

const fmt = (v: number) =>
  v.toLocaleString(undefined, { maximumFractionDigits: 2 })

interface ChartRow {
  t: string
  predicted: number
  actual: number | null
}

export function EvaluationChart({
  preds,
  points,
}: {
  preds: PredPoint[]
  points: EvalPoint[]
}) {
  const reduced = usePrefersReducedMotion()

  if (preds.length === 0) {
    return (
      <div className="flex h-80 items-center justify-center text-sm text-muted-foreground">
        No prediction data available
      </div>
    )
  }

  const label = (iso: string) =>
    new Date(iso).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
    })

  // Full predicted line; overlay lab/actual only where an applied point aligns.
  const actualByTs = new Map(points.map(p => [p.timestamp, p.actual]))
  const data: ChartRow[] = preds.map(p => ({
    t: label(p.timestamp),
    predicted: p.predicted,
    actual: actualByTs.get(p.timestamp) ?? null,
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
        {/* Predicted — solid cyan, full series. */}
        <Line
          dataKey="predicted"
          type="monotone"
          stroke="var(--color-predicted)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={!reduced}
        />
        {/* Lab (actual) — dashed blue, sparse user ground-truth points. */}
        <Line
          dataKey="actual"
          type="monotone"
          stroke="var(--color-actual)"
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={{ r: 3 }}
          connectNulls
          isAnimationActive={!reduced}
        />
      </LineChart>
    </ChartContainer>
  )
}
