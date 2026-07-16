'use client'

import { useEffect, useMemo, useState } from 'react'
import { LineChart, CartesianGrid, XAxis, YAxis, Line } from 'recharts'
import { LineChart as LineChartIcon } from 'lucide-react'
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
import type { SensorChartRow } from '@/hooks/use-sensor-readings'
import { RangeDisplay } from './range-display'
import { TagsSelector } from './tags-selector'

interface Props {
  rows: SensorChartRow[]
  tags: string[]
  range: TimeRange
  hideTagSelector?: boolean
  /** Emphasized tag(s) from the sidebar — non-focused lines dim when set. */
  focusedTag?: string[]
  /** Master override: when true, every line renders at full opacity. */
  isViewAll?: boolean
}

/**
 * Per-line stroke opacity. "View all" forces full opacity, overriding focus;
 * otherwise a non-empty focus set dims everything but the focused tag(s).
 */
function getLineOpacity(
  tagId: string,
  focusedTag: string[] | undefined,
  isViewAll: boolean,
): number {
  if (isViewAll) return 1
  if (focusedTag && focusedTag.length > 0)
    return focusedTag.includes(tagId) ? 1 : 0.2
  return 1
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

function fmtTs(isoOrMs: string | number): string {
  return new Date(isoOrMs).toLocaleString('en-GB', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function durStr(ms: number): string {
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60),
    rm = m % 60
  if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

export function RawTrendChart({
  rows,
  tags,
  range,
  hideTagSelector = false,
  focusedTag,
  isViewAll = false,
}: Props) {
  const reducedMotion = usePrefersReducedMotion()
  const { tickFormat } = rangeConfig(range)

  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const handleVisible = (next: string[] | null) =>
    setHidden(
      next === null ? new Set() : new Set(tags.filter(t => !next.includes(t))),
    )

  const [zoomWindow, setZoomWindow] = useState<[number, number] | null>(null)
  useEffect(() => {
    setZoomWindow(null)
  }, [rows])

  const isZoomed =
    zoomWindow !== null &&
    (zoomWindow[0] > 0 || zoomWindow[1] < rows.length - 1)

  const colorByTag = useMemo(
    () =>
      Object.fromEntries(
        tags.map(t => [t, chartColorVar(resolveTagMeta(t).chartIndex)]),
      ) as Record<string, string>,
    [tags],
  )

  const config = useMemo<ChartConfig>(() => {
    return Object.fromEntries(
      tags.map(piTag => {
        const meta = resolveTagMeta(piTag)
        return [piTag, { label: meta.label, color: colorByTag[piTag] }]
      }),
    )
  }, [tags, colorByTag])

  const w0 = zoomWindow?.[0] ?? 0
  const w1 = zoomWindow?.[1] ?? rows.length - 1
  const rangeStart = rows.length ? fmtTs(rows[w0]!.timestamp as string) : null
  const rangeEnd = rows.length ? fmtTs(rows[w1]!.timestamp as string) : null
  const rangeDur =
    rows.length > 1
      ? durStr(
          new Date(rows[w1]!.timestamp as string).getTime() -
            new Date(rows[w0]!.timestamp as string).getTime(),
        )
      : null

  const visibleTags = tags.filter(t => !hidden.has(t))

  if (tags.length === 0) {
    return (
      <div className="flex h-80 flex-col items-center justify-center gap-2 text-center">
        <LineChartIcon className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          Select one or more PI tags to plot
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* ── Tag selector (visible-series control) ── */}
      {!hideTagSelector && (
        <TagsSelector
          available={tags}
          active={visibleTags}
          onChange={handleVisible}
        />
      )}

      <RangeDisplay
        startTs={rangeStart}
        endTs={rangeEnd}
        duration={rangeDur}
        isZoomed={isZoomed}
        onReset={() => setZoomWindow(null)}
      />

      {/* ── Main chart ── */}
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

          {visibleTags.map(piTag => {
            const opacity = getLineOpacity(piTag, focusedTag, isViewAll)
            const isFocused = !isViewAll && !!focusedTag?.includes(piTag)
            return (
              <Line
                key={piTag}
                dataKey={(row: SensorChartRow) => row[piTag]}
                name={piTag}
                type="natural"
                stroke={colorByTag[piTag]}
                strokeOpacity={opacity}
                strokeWidth={isFocused ? 3 : 2}
                fill={colorByTag[piTag]}
                fillOpacity={opacity < 1 ? 0 : 0.12}
                dot={{ r: 3, fill: colorByTag[piTag] }}
                activeDot={{ r: 6 }}
                connectNulls
                isAnimationActive={!reducedMotion}
              />
            )
          })}

          {/* {rows.length > 2 && (
            <Brush
              dataKey="timestamp"
              height={28}
              travellerWidth={10}
              stroke="var(--border)"
              fill="var(--muted)"
              startIndex={zoomWindow?.[0]}
              endIndex={zoomWindow?.[1]}
              tickFormatter={value => {
                try {
                  return new Date(String(value)).toLocaleTimeString('en-GB', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                } catch {
                  return ''
                }
              }}
              onChange={(r: { startIndex?: number; endIndex?: number }) => {
                if (
                  typeof r.startIndex === 'number' &&
                  typeof r.endIndex === 'number'
                ) {
                  setZoomWindow([r.startIndex, r.endIndex])
                }
              }}
            />
          )} */}
        </LineChart>
      </ChartContainer>
    </div>
  )
}
