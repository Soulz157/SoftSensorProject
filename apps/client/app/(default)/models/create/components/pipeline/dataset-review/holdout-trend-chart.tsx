'use client'

import { useMemo, useState } from 'react'
import { LineChart as LineChartIcon } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { SegmentedToggle } from '@/components/segmented-toggle'
import { RawTrendChart } from '@/app/(default)/data-studio/create/components/chart/raw-data-chart'
import { toChartRows, type Dataset } from '@/lib/preprocessing'
import { clipToHoldoutWindow, validationChartTags } from '@/lib/holdout'

interface Props {
  /** The validation sidecar page, unclipped — this component clips it. */
  sample: Dataset | null
  totalRowCount: number | null
  loading: boolean
  missing: boolean
  error: string | null
  holdoutFrom: string
  holdoutTo: string | null
}

type TagView = 'lab' | 'all'

const NOTE_CLASS =
  'rounded-lg border border-border p-4 text-center text-xs text-muted-foreground'

/**
 * Validation rows as a line chart, so a target that stops moving inside the
 * holdout (a lab value carried forward for months) is visible BEFORE training
 * instead of showing up as an unscorable R². Presentational: every fetch and
 * the clip arithmetic live in the hook / `lib/holdout.ts`.
 *
 * The rows are a chronological prefix of the sidecar, not a decimated sample
 * (`useArtifactValidationRows`), so a truncated read is stated, never implied
 * to be the whole window.
 */
export function HoldoutTrendChart({
  sample,
  totalRowCount,
  loading,
  missing,
  error,
  holdoutFrom,
  holdoutTo,
}: Props) {
  const [view, setView] = useState<TagView>('lab')

  const clipped = useMemo(
    () => (sample ? clipToHoldoutWindow(sample, holdoutFrom, holdoutTo) : null),
    [sample, holdoutFrom, holdoutTo],
  )
  const chartRows = useMemo(
    () => (clipped ? toChartRows(clipped) : []),
    [clipped],
  )
  const tagChoice = useMemo(
    () => validationChartTags(clipped?.tags ?? []),
    [clipped],
  )

  if (loading && !sample) {
    return <Skeleton className="h-64 w-full rounded-lg" />
  }
  if (error) {
    return (
      <p className={NOTE_CLASS}>Could not load validation rows — {error}</p>
    )
  }
  if (missing) {
    return (
      <p className={NOTE_CLASS}>
        The validation rows are no longer in storage, so there is nothing to
        chart. Re-saving the dataset restores them.
      </p>
    )
  }
  if (!clipped || chartRows.length === 0) {
    return (
      <p className={NOTE_CLASS}>No validation rows to chart in this window.</p>
    )
  }

  const tags =
    view === 'lab' && tagChoice.hasLabSubset ? tagChoice.initial : tagChoice.all
  const shown = clipped.rows.length
  // Rows the server holds beyond this page. `totalRowCount` counts the whole
  // sidecar INCLUDING any lead-in the clip removed, so it is only quoted when
  // the page itself was cut short.
  const truncated =
    totalRowCount !== null && totalRowCount > sample!.rows.length

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <LineChartIcon className="h-3.5 w-3.5" />
          {truncated
            ? `Showing the first ${shown.toLocaleString()} of ${totalRowCount.toLocaleString()} validation rows`
            : `${shown.toLocaleString()} validation rows`}
        </p>
        {tagChoice.hasLabSubset && (
          <SegmentedToggle<TagView>
            ariaLabel="Validation chart tags"
            value={view}
            onChange={setView}
            options={[
              { value: 'lab', label: 'Lab tags' },
              { value: 'all', label: 'All tags' },
            ]}
          />
        )}
      </div>
      <RawTrendChart rows={chartRows} tags={tags} range="7d" dateOnlyTicks />
    </div>
  )
}
