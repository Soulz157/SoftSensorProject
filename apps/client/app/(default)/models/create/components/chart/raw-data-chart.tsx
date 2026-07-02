'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  LineChart,
  Brush,
  CartesianGrid,
  XAxis,
  YAxis,
  Line,
  ReferenceLine,
} from 'recharts'
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
import { useCutoffRules } from '@/hooks/use-cutoff-rule'
import { applyClipRules, buildHighlightSet } from '@/lib/cutoff-utils'
import { CutoffPanel } from './cutoff-panel'
import { RangeDisplay } from './range-display'
import { TagsSelector } from '../pipeline/tags-selector'

interface Props {
  rows: SensorChartRow[]
  tags: string[]
  range: TimeRange
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

function HlDot(hlSet: Set<string>, tag: string, baseColor: string) {
  return function Dot(props: { cx?: number; cy?: number; index?: number }) {
    const { cx, cy, index } = props
    const isHl = hlSet.has(`${tag}__${index}`)
    if (!isHl) {
      return <circle cx={cx} cy={cy} r={3} fill={baseColor} />
    }
    return (
      <circle
        cx={cx}
        cy={cy}
        r={6}
        fill="#f59e0b"
        stroke="#fff"
        strokeWidth={1.5}
      />
    )
  }
}

export function RawTrendChart({ rows, tags, range }: Props) {
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

  const {
    rules,
    add,
    update,
    remove,
    toggle: toggleRule,
  } = useCutoffRules(tags[0] ?? '')

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

  const displayRows = useMemo(() => applyClipRules(rows, rules), [rows, rules])

  const hlSet = useMemo(() => buildHighlightSet(rows, rules), [rows, rules])

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

  const hlThresholds = useMemo(() => {
    return rules.filter(
      r => r.enabled && r.mode === 'highlight' && r.value !== '',
    )
  }, [rules])

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
      <TagsSelector
        available={tags}
        active={visibleTags}
        onChange={handleVisible}
      />

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
          data={displayRows}
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

          {hlThresholds.map(rule => (
            <ReferenceLine
              key={rule.id}
              y={rule.value as number}
              stroke="#f59e0b"
              strokeDasharray="4 3"
              strokeWidth={1.5}
              label={{
                value: `${rule.tag} ${rule.op} ${rule.value}`,
                position: 'insideTopRight',
                fontSize: 10,
                fill: '#f59e0b',
              }}
            />
          ))}

          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={value =>
                  new Date(String(value)).toLocaleString()
                }
              />
            }
          />

          {visibleTags.map(piTag => (
            <Line
              key={piTag}
              dataKey={(row: SensorChartRow) => row[piTag]}
              name={piTag}
              type="natural"
              stroke={colorByTag[piTag]}
              fill={colorByTag[piTag]}
              fillOpacity={0.12}
              strokeWidth={2}
              dot={HlDot(hlSet, piTag, colorByTag[piTag] ?? '')}
              activeDot={{ r: 6 }}
              connectNulls
              isAnimationActive={!reducedMotion}
            />
          ))}

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

      <CutoffPanel
        tags={tags}
        rules={rules}
        onAdd={add}
        onUpdate={update}
        onRemove={remove}
        onToggle={toggleRule}
      />
    </div>
  )
}
