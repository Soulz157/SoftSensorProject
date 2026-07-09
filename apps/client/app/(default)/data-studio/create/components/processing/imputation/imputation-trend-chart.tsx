'use client'

import { useEffect, useState } from 'react'
import { LineChart, CartesianGrid, XAxis, YAxis, Line } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import {
  rangeConfig,
  resolveTagMeta,
  chartColorVar,
  type TimeRange,
} from '@/lib/mock-readings'
import type { TagFillPreviewRow } from '@/lib/preprocessing'
import { SegmentedToggle } from '@/app/(default)/data-visualize/components/segmented-toggle'

interface Props {
  rows: TagFillPreviewRow[]
  tag: string
  range: TimeRange
}

type View = 'original' | 'imputed' | 'overlay'

const VIEW_OPTIONS: { value: View; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: 'imputed', label: 'Imputed' },
  { value: 'overlay', label: 'Overlay Both' },
]

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

/** Before/after preview line chart for a single tag's fill strategy in Step 5.2. */
export function ImputationTrendChart({ rows, tag, range }: Props) {
  const reducedMotion = usePrefersReducedMotion()
  const { tickFormat } = rangeConfig(range)
  const [view, setView] = useState<View>('overlay')

  const afterColor = chartColorVar(resolveTagMeta(tag).chartIndex)

  const config: ChartConfig = {
    before: { label: 'Original', color: 'var(--muted-foreground)' },
    after: { label: 'Imputed', color: afterColor },
  }

  const showBefore = view === 'original' || view === 'overlay'
  const showAfter = view === 'imputed' || view === 'overlay'

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Before &amp; After Preview
          </h3>
          <p className="text-xs text-muted-foreground">
            Visualizing the impact of imputation over time.
          </p>
        </div>
        <SegmentedToggle
          ariaLabel="Trend view"
          value={view}
          onChange={setView}
          options={VIEW_OPTIONS}
        />
      </div>

      <ChartContainer config={config} className="h-100 w-full">
        <LineChart
          accessibilityLayer
          data={rows}
          margin={{ left: 12, right: 12 }}
        >
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
                labelFormatter={value =>
                  new Date(String(value)).toLocaleString()
                }
              />
            }
          />

          {showBefore && (
            <Line
              dataKey={(row: TagFillPreviewRow) => row.before}
              name="Original"
              type="natural"
              stroke="var(--muted-foreground)"
              strokeDasharray="6 3"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              isAnimationActive={!reducedMotion}
            />
          )}

          {showAfter && (
            <Line
              dataKey={(row: TagFillPreviewRow) => row.after}
              name="Imputed"
              type="natural"
              stroke={afterColor}
              strokeWidth={2}
              fill={afterColor}
              fillOpacity={0.12}
              dot={{ r: 2, fill: afterColor }}
              activeDot={{ r: 5 }}
              connectNulls={false}
              isAnimationActive={!reducedMotion}
            />
          )}
        </LineChart>
      </ChartContainer>
    </div>
  )
}
