'use client'

import { CircleAlert, CircleCheck, CircleHelp, Rows3 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { datasetQuality } from '@/lib/data-quality'
import type { Dataset } from '@/lib/preprocessing'
import type { TimeRange } from '@/lib/mock-readings'

// `range` is the fetched time window (span), not the sampling cadence.
const RANGE_LABELS: Record<TimeRange, string> = {
  '24h': 'Last 24 h',
  '7d': 'Last 7 days',
  '1m': 'Last 30 days',
  '1y': 'Last 1 year',
}

interface Props {
  dataset: Dataset
  range: TimeRange
}

export function QualitySummaryBadges({ dataset, range }: Props) {
  const q = datasetQuality(dataset)
  const rows = dataset.rows.length

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant="outline" className="text-muted-foreground">
        {RANGE_LABELS[range]}
      </Badge>
      <Badge variant="secondary" className="gap-1">
        <Rows3 className="h-3 w-3" />
        {rows.toLocaleString()} rows
      </Badge>

      {q.missing > 0 ? (
        <Badge className="gap-1 bg-destructive/15 text-destructive">
          <CircleAlert className="h-3 w-3" />
          {q.missing} Bad {q.missing === 1 ? 'Cell' : 'Cells'}
        </Badge>
      ) : null}

      {q.suspect > 0 ? (
        <Badge className="gap-1 bg-amber-500/15 text-amber-500">
          <CircleHelp className="h-3 w-3" />
          {q.suspect} Questionable
        </Badge>
      ) : null}

      {q.missing === 0 && q.suspect === 0 ? (
        <Badge className="gap-1 bg-emerald-500/15 text-emerald-500">
          <CircleCheck className="h-3 w-3" />
          Clean
        </Badge>
      ) : null}
    </div>
  )
}
