'use client'

import { useEffect, useState } from 'react'
import { LineChart, CartesianGrid, XAxis, YAxis, Line } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { cn } from '@/lib/utils'
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
  tags: string[]
  isolatedTag: string
  onIsolate: (tag: string) => void
  range: TimeRange
}

type View = 'original' | 'cleaned' | 'overlay'

const VIEW_OPTIONS: { value: View; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: 'cleaned', label: 'Cleaned' },
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

export function ImputationTrendChart({
  rows,
  tags,
  isolatedTag,
  onIsolate,
  range,
}: Props) {
  const reducedMotion = usePrefersReducedMotion()
  const { tickFormat } = rangeConfig(range)
  const [view, setView] = useState<View>('overlay')

  const afterColor = chartColorVar(resolveTagMeta(isolatedTag).chartIndex)

  const config: ChartConfig = {
    before: { label: 'Original', color: 'var(--muted-foreground)' },
    after: { label: 'Cleaned', color: afterColor },
  }

  const showBefore = view === 'original' || view === 'overlay'
  const showAfter = view === 'cleaned' || view === 'overlay'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Before &amp; After Preview
          </h3>
          <p className="text-xs text-muted-foreground">
            Visualizing the impact of the cleaning pipeline over time.
          </p>
        </div>
        <SegmentedToggle
          ariaLabel="Trend view"
          value={view}
          onChange={setView}
          options={VIEW_OPTIONS}
        />
      </div>

      {/* Isolate legend — pick which selected tag's before/after to show. */}
      {tags.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">
            Isolate:
          </span>
          {tags.map(tag => {
            const active = tag === isolatedTag
            return (
              <button
                key={tag}
                type="button"
                onClick={() => onIsolate(tag)}
                className={cn(
                  'inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] transition-colors',
                  active
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:bg-muted',
                )}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    backgroundColor: chartColorVar(
                      resolveTagMeta(tag).chartIndex,
                    ),
                  }}
                />
                {tag}
              </button>
            )
          })}
        </div>
      )}

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
