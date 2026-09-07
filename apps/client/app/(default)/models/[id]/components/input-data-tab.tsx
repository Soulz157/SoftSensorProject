'use client'

import { useMemo, useState } from 'react'
import { Database } from 'lucide-react'
import type { AIModel } from '@/types'
import { usePredictionMonitoring } from '@/hooks/model/use-prediction-monitoring'
import type { TimeRange } from '@/lib/mock-readings'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { TimeRangeToggle } from './monitoring/time-range-toggle'

interface Props {
  model: AIModel
}

/**
 * Real logged input tags — the most recent sampled `/predict` request's raw
 * feature values (see MODEL-SERVE-005-T01, `PredictionLog`). No mock: the
 * old inline table here (`generateReadings`) invented tag names
 * (`Temp_01`, `Pressure_A`, …) that never came from any model. This reads
 * `points[].features`, the same real feature-key map the Monitoring tab's
 * Distribution Drift panel is built on — a mismatch between the two tabs'
 * tag names would mean one of them is wrong.
 *
 * `featureColumns` (the ordered, authoritative X list) lives behind
 * `ServingTokenGuard` and is unreachable from the browser JWT — this tab
 * shows what was actually logged, and says so plainly when nothing was,
 * rather than fabricating a static tag list.
 */
export function InputDataTab({ model }: Props) {
  const [range, setRange] = useState<TimeRange>('24h')
  const { points, pointsLoading, pointsTruncated } = usePredictionMonitoring(
    model,
    range,
  )

  const latest = points[points.length - 1] ?? null
  const rows = useMemo(() => {
    if (!latest) return []
    return Object.entries(latest.features)
      .map(([tag, value]) => ({ tag, value }))
      .sort((a, b) => a.tag.localeCompare(b.tag))
  }, [latest])

  const isEmpty = !pointsLoading && rows.length === 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {latest ? (
            <>
              Logged {new Date(latest.timestamp).toLocaleString()} ·{' '}
              {points.length} sampled request{points.length === 1 ? '' : 's'} in
              range
              {pointsTruncated && ' · truncated'}
            </>
          ) : (
            'No sampled requests in range'
          )}
        </div>
        <TimeRangeToggle range={range} onRange={setRange} />
      </div>

      <Card className="overflow-hidden border-border bg-card">
        {pointsLoading ? (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
            <Database className="h-10 w-10 opacity-30" />
            <p className="text-base font-medium">No prediction inputs logged</p>
            <p className="text-sm">
              This model has not served /predict traffic in the selected range.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tag</TableHead>
                <TableHead className="text-right">Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-border">
              {rows.map(row => (
                <TableRow key={row.tag}>
                  <TableCell className="font-mono text-xs font-medium text-foreground">
                    {row.tag}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums text-foreground">
                    {row.value}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}
