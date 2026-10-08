'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  ReferenceLine,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { tagMeta } from '@/lib/mock-readings'
import { mostCorrelatedPartner, pearsonMatrix } from '@/lib/data-quality'
import {
  CORRELATED_PAIR,
  linearRegression,
  regressionSegment,
  toScatterPoints,
  type Dataset,
} from '@/lib/preprocessing'

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

function defaultPair(tags: string[]): { x: string; y: string } {
  if (
    tags.includes(CORRELATED_PAIR.anchor) &&
    tags.includes(CORRELATED_PAIR.derived)
  ) {
    return { x: CORRELATED_PAIR.anchor, y: CORRELATED_PAIR.derived }
  }
  return { x: tags[0] ?? '', y: tags[1] ?? tags[0] ?? '' }
}

const fmt = (v: number) =>
  v.toLocaleString(undefined, { maximumFractionDigits: 2 })

interface Props {
  dataset: Dataset
  /**
   * When set, locks Y to this tag (e.g. driven by an external tag selector)
   * and defaults X to its most-correlated partner. X remains user-changeable
   * via its own select; re-defaults whenever `forcedY` changes.
   */
  forcedY?: string
}

export function ScatterRegressionChart({ dataset, forcedY }: Props) {
  const { tags } = dataset
  const reduced = usePrefersReducedMotion()

  const init = defaultPair(tags)
  const [xTag, setXTag] = useState(init.x)
  const [yTag, setYTag] = useState(init.y)

  const hasForcedY = forcedY !== undefined && tags.includes(forcedY)

  const forcedDefaultX = useMemo(() => {
    if (!hasForcedY) return null
    const matrix = pearsonMatrix(dataset)
    return (
      mostCorrelatedPartner(matrix, forcedY!) ??
      tags.find(t => t !== forcedY) ??
      forcedY!
    )
  }, [hasForcedY, dataset, forcedY, tags])

  // Re-default X whenever the externally-forced Y tag changes — adjusted
  // during render (React's documented "adjusting state when a prop
  // changes" pattern) rather than in an effect, to avoid the extra render
  // pass a setState-in-effect would cause.
  const [prevForcedY, setPrevForcedY] = useState(forcedY)
  if (forcedY !== prevForcedY) {
    setPrevForcedY(forcedY)
    if (forcedDefaultX) setXTag(forcedDefaultX)
  }

  const defaulted = defaultPair(tags)
  const resolvedX = tags.includes(xTag) ? xTag : (forcedDefaultX ?? defaulted.x)
  const resolvedY = hasForcedY
    ? forcedY!
    : tags.includes(yTag)
      ? yTag
      : defaulted.y

  const points = useMemo(
    () => toScatterPoints(dataset, resolvedX, resolvedY),
    [dataset, resolvedX, resolvedY],
  )
  const reg = useMemo(() => linearRegression(points), [points])
  const segment =
    points.length >= 2
      ? regressionSegment(points, reg.slope, reg.intercept)
      : null

  const xMeta = tagMeta(resolvedX)
  const yMeta = tagMeta(resolvedY)

  const config: ChartConfig = {
    x: { label: xMeta?.label ?? resolvedX, color: 'var(--chart-2)' },
    y: { label: yMeta?.label ?? resolvedY, color: 'var(--chart-2)' },
  }

  if (tags.length < 2) {
    return (
      <div className="flex h-80 items-center justify-center text-sm text-muted-foreground">
        Select at least two channels to compare
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">X</span>
          <Select value={resolvedX} onValueChange={setXTag}>
            {' '}
            {/* ✅ ใช้ resolvedX */}
            <SelectTrigger className="h-8 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {tags.map(t => (
                <SelectItem key={t} value={t}>
                  {tagMeta(t)?.label ?? t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {hasForcedY ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Y</span>
            <span className="font-mono text-xs text-foreground">
              {yMeta?.label ?? resolvedY}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Y</span>
            <Select value={resolvedY} onValueChange={setYTag}>
              <SelectTrigger className="h-8 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {tags.map(t => (
                  <SelectItem key={t} value={t}>
                    {tagMeta(t)?.label ?? t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="ml-auto rounded-md bg-muted px-2.5 py-1 font-mono text-xs text-foreground">
          y = {fmt(reg.slope)}x + {fmt(reg.intercept)} · R² ={' '}
          {reg.r2.toFixed(3)}
        </div>
      </div>

      <ChartContainer config={config} className="h-80 w-full">
        <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid />
          <XAxis
            type="number"
            dataKey="x"
            name={xMeta?.label ?? resolvedX}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={fmt}
            domain={['auto', 'auto']}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={yMeta?.label ?? resolvedY}
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={fmt}
            domain={['auto', 'auto']}
          />
          <ZAxis range={[50, 50]} />
          <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
          <Scatter
            data={points}
            fill="var(--chart-2)"
            isAnimationActive={!reduced}
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
        </ScatterChart>
      </ChartContainer>
    </div>
  )
}
