'use client'

import { useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { formatAxisValue } from '@/lib/monitoring'
import { xRows } from '@/lib/evaluation-compare'
import type { EvaluationCompareResult } from '@/services/model-evaluation'
import { EVALUATION_SYNC_ID } from './evaluation-chart'

/** A model can read dozens of base tags; drawing every one on first paint is
 *  both slow and unreadable, so the panel opens on the first few. */
const INITIAL_TAGS = 6

const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 10 }

/**
 * MODEL-SERVE-032. The model's raw input (X) tags over the imported range,
 * one small chart per tag, read-only. They share the main chart's
 * `syncId` and its row grid index-for-index, so hovering either moves the
 * cursor through all of them. A Bad reading is a gap, not a zero.
 */
export function EvaluationXPanel({
  data,
}: {
  data: Pick<EvaluationCompareResult, 'points' | 'features'>
}) {
  const tags = Object.keys(data.features)
  const [showAll, setShowAll] = useState(false)
  if (tags.length === 0) return null

  const shown = showAll ? tags : tags.slice(0, INITIAL_TAGS)

  return (
    <section className="space-y-3" aria-label="Input tags">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          Input tags (X)
        </h3>
        {tags.length > INITIAL_TAGS && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setShowAll(v => !v)}
          >
            {showAll ? 'Show fewer' : `Show all ${tags.length}`}
          </Button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {shown.map(tag => (
          <div
            key={tag}
            className="rounded-lg border border-border bg-card px-3 pt-2"
          >
            <p className="truncate text-xs font-medium text-muted-foreground">
              {tag}
            </p>
            <ResponsiveContainer width="100%" height={96}>
              <LineChart
                data={xRows(data, tag)}
                syncId={EVALUATION_SYNC_ID}
                margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--border)"
                  vertical={false}
                />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={['dataMin', 'dataMax']}
                  hide
                />
                <YAxis
                  domain={['auto', 'auto']}
                  tick={AXIS_TICK}
                  stroke="var(--border)"
                  width={52}
                  tickFormatter={formatAxisValue}
                />
                <Line
                  type="monotone"
                  dataKey="v"
                  stroke="var(--chart-2)"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>
    </section>
  )
}
