'use client'

import { useMemo } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import type { ArtifactHoldout } from '@/services/dataset-version'
import { splitTimeline } from '@/lib/holdout'

interface Props {
  /** The training artifact's first/last reading (its footer metadata). */
  dataStart: string | null
  dataEnd: string | null
  trainRows: number
  holdout: ArtifactHoldout | null
  loading: boolean
}

/** Keeps a one-month band in a multi-year span visible. */
const MIN_BAND_PCT = 1.5

/**
 * "How the data is split" — the strip at the top of Model Step 2. One bar for
 * the dataset's time span with the validation window marked on it, and the
 * row count of each side, so the split is visible before any scrolling.
 *
 * Validation is drawn in `chart-5` here, in the Validation data section's
 * icon and in its badge: one color for one kind of data across the step.
 * Training data stays a neutral tone; it is the default, not a signal.
 */
export function SplitOverview({
  dataStart,
  dataEnd,
  trainRows,
  holdout,
  loading,
}: Props) {
  const timeline = useMemo(
    () =>
      splitTimeline({
        dataStart,
        dataEnd,
        holdoutFrom: holdout?.holdoutFrom,
        holdoutTo: holdout?.holdoutTo,
      }),
    [dataStart, dataEnd, holdout],
  )

  if (loading) {
    return <Skeleton className="h-28 w-full rounded-xl" />
  }
  if (!timeline) return null

  const band = timeline.validation
  const bandWidth = band ? Math.max(band.widthPct, MIN_BAND_PCT) : 0
  // Keep a widened band inside the bar when it sits at the right edge.
  const bandLeft = band ? Math.min(band.leftPct, 100 - bandWidth) : 0
  const ariaLabel = band
    ? `Training data ${timeline.startDay} to ${timeline.endDay}, validation from ${band.fromDay}`
    : `Training data ${timeline.startDay} to ${timeline.endDay}, no validation window`

  return (
    <section
      aria-labelledby="split-overview-title"
      className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
    >
      <h3
        id="split-overview-title"
        className="text-sm font-semibold text-foreground"
      >
        How the data is split
      </h3>

      <div
        role="img"
        aria-label={ariaLabel}
        className="relative h-6 overflow-hidden rounded-md bg-muted-foreground/25"
      >
        {band && (
          <div
            className="absolute inset-y-0 bg-chart-5"
            style={{ left: `${bandLeft}%`, width: `${bandWidth}%` }}
          />
        )}
      </div>

      <div className="flex justify-between gap-2 font-mono text-[11px] text-muted-foreground tabular-nums">
        <span>{timeline.startDay}</span>
        {band && band.leftPct > 8 && band.leftPct < 85 && (
          <span>{band.fromDay}</span>
        )}
        <span>{timeline.endDay}</span>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-muted-foreground/25" />
          Training data
          <span className="font-mono tabular-nums">
            {trainRows.toLocaleString()}
          </span>
          rows
        </span>
        {band && holdout ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-chart-5" />
            Validation
            <span className="font-mono tabular-nums">
              {holdout.rowCount.toLocaleString()}
            </span>
            rows from {band.fromDay}
          </span>
        ) : (
          <span className="text-muted-foreground">
            No validation window. Models are scored on the test split only.
          </span>
        )}
      </div>
    </section>
  )
}
