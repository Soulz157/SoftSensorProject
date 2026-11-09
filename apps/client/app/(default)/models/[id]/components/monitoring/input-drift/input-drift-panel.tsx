'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  ColumnRangeDrift,
  InputDriftReport,
} from '@/services/model-monitoring'
import {
  explainInputDriftReport,
  explainRangeDrift,
  formatPct,
  sortBySeverity,
  trainRangeLabel,
} from '@/lib/input-drift'
import {
  explainTargetRange,
  unrecordedTargetColumn,
  withTargetFirst,
} from '@/lib/monitoring-target-row'
import { StatusBadgeWithExplanation } from '../status-badge-with-explanation'
import { TargetBadge } from '../target-badge'
import { InputDriftDetail } from './input-drift-detail'
import { InputTrendSparkline } from './input-trend-sparkline'

interface Props {
  report: InputDriftReport | null
  loading: boolean
  unavailableReason: string | null
}

const ROW_GRID =
  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 md:grid-cols-[minmax(9rem,1.1fr)_minmax(8rem,2fr)_5.5rem_minmax(8rem,1fr)]'

function formatSpan(fromIso: string, toIso: string): string {
  try {
    return `${format(new Date(fromIso), 'MMM d, HH:mm')} – ${format(new Date(toIso), 'MMM d, HH:mm')}`
  } catch {
    return `${fromIso} – ${toIso}`
  }
}

/**
 * MODEL-SERVE-036. The Input Drift card: one row per input tag with its own
 * trend, its share of live values outside the training range, and the
 * verdict. A row opens to Deep Detail. Flagged tags sort first; the target
 * (y) is pinned on top and never counts toward the card's verdict.
 *
 * The row toggle is a real button (aria-expanded) and the status badge sits
 * BESIDE it, never inside — the badge is itself a button for its tooltip,
 * and a button inside a button is invalid.
 */
export function InputDriftPanel({ report, loading, unavailableReason }: Props) {
  const [open, setOpen] = useState<Set<string>>(new Set())

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        Loading input drift…
      </div>
    )
  }
  if (unavailableReason) {
    return (
      <div className="flex h-32 items-center justify-center px-6 text-center text-sm text-muted-foreground">
        {unavailableReason}
      </div>
    )
  }
  if (!report || report.columns.length === 0) {
    return (
      <div className="flex h-32 flex-col items-center justify-center gap-1 px-6 text-center">
        <p className="text-sm text-muted-foreground">
          No input values in this range.
        </p>
        <p className="text-xs text-muted-foreground/70">
          {report?.basis.plane === 'predict'
            ? 'No /predict requests were logged in the selected range.'
            : 'No inference window finished in the selected range.'}
        </p>
      </div>
    )
  }

  const { basis } = report
  const unit = basis.plane === 'window' ? 'window' : 'hour'
  const rows = withTargetFirst(sortBySeverity(report.columns), report.target)
  const unrecorded = unrecordedTargetColumn(report)
  const toggle = (key: string) =>
    setOpen(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {basis.windowsUsed} {unit}
          {basis.windowsUsed === 1 ? '' : 's'} ·{' '}
          {formatSpan(basis.from, basis.to)} · version {basis.version}
          {basis.missing > 0 && ` · ${basis.missing} unreadable, skipped`}
        </span>
        <StatusBadgeWithExplanation
          status={report.status}
          explanation={explainInputDriftReport(report)}
        />
      </div>
      {basis.capped && (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Showing the newest {basis.maxDays} days only — longer ranges are not
          read from the per-minute input files.
        </p>
      )}
      {basis.truncated && (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Too many logged requests in this range — only part of them were
          read, so these figures cover a sample. Narrow the range for all of
          them.
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="hidden items-center bg-muted/50 text-xs font-medium text-muted-foreground md:flex">
          <div className={cn(ROW_GRID, 'flex-1 px-3 py-2')}>
            <span className="pl-5">Tag</span>
            <span>Trend</span>
            <span className="text-right">Out of range</span>
            <span>Training range</span>
          </div>
          <span className="w-32 shrink-0 px-3 py-2">Status</span>
        </div>
        <ul>
          {unrecorded && (
            <li className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground">
              <span className="pl-5 font-mono">{unrecorded}</span>
              <TargetBadge />
              <span className="ml-2 italic">
                Not recorded in this range — needs a training range for the
                target and windows written after target tracking shipped.
              </span>
            </li>
          )}
          {rows.map(({ row: col, isTarget }) => {
            const key = isTarget ? `target:${col.column}` : col.column
            return (
              <DriftRow
                key={key}
                id={key}
                col={col}
                isTarget={isTarget}
                isOpen={open.has(key)}
                onToggle={() => toggle(key)}
                report={report}
              />
            )
          })}
        </ul>
      </div>

      <p className="text-[11px] text-muted-foreground/70">
        A live value below the training min or above the training max is out of
        range. An input is WARN at {basis.thresholds.outOfRangeWarnPct}% and
        CRITICAL at {basis.thresholds.outOfRangeCriticalPct}% of its live
        values, and needs at least {basis.thresholds.minSamples} values to be
        graded. These cutoffs are conventions, not measured on this plant. Model
        health and alerts grade the newest {basis.healthWindows} windows, not
        the range shown here.
      </p>
    </div>
  )
}

function DriftRow({
  id,
  col,
  isTarget,
  isOpen,
  onToggle,
  report,
}: {
  id: string
  col: ColumnRangeDrift
  isTarget: boolean
  isOpen: boolean
  onToggle: () => void
  report: InputDriftReport
}) {
  const series = report.series[col.column]
  const panelId = `input-drift-detail-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`
  const flagged = col.status === 'WARN' || col.status === 'CRITICAL'

  return (
    <li className="border-t border-border first:border-t-0">
      <div className={cn('flex items-stretch', isOpen && 'bg-muted/20')}>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={onToggle}
          className={cn(
            ROW_GRID,
            'min-w-0 flex-1 cursor-pointer px-3 py-2 text-left text-xs transition-colors hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset',
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5 font-mono">
            <ChevronRight
              aria-hidden="true"
              className={cn(
                'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                isOpen && 'rotate-90',
              )}
            />
            <span className="truncate">{col.column}</span>
            {isTarget && <TargetBadge />}
          </span>
          <span className="col-span-2 row-start-2 md:col-span-1 md:row-start-auto">
            <InputTrendSparkline
              series={series}
              trainMin={col.trainMin}
              trainMax={col.trainMax}
              emptyLabel={isTarget ? 'Trend not stored' : 'No live values'}
            />
          </span>
          <span
            className={cn(
              'col-start-2 row-start-1 text-right font-mono tabular-nums md:col-start-auto md:row-start-auto',
              flagged ? 'font-medium text-foreground' : 'text-muted-foreground',
            )}
          >
            {formatPct(col.outOfRangePct)}
          </span>
          <span className="hidden font-mono text-muted-foreground tabular-nums md:inline">
            {trainRangeLabel(col)}
          </span>
        </button>
        <div className="flex w-32 shrink-0 flex-col justify-center px-3 py-2">
          <StatusBadgeWithExplanation
            status={col.status}
            explanation={
              isTarget
                ? explainTargetRange(col, report.basis.thresholds)
                : explainRangeDrift(col, report.basis.thresholds)
            }
          />
          {col.status === 'INSUFFICIENT_DATA' && (
            <span className="mt-0.5 text-[10px] text-muted-foreground">
              {col.liveTotal} of {report.basis.thresholds.minSamples} values
            </span>
          )}
        </div>
      </div>
      {isOpen && (
        <div id={panelId} className="border-t border-border/60 bg-muted/10">
          <InputDriftDetail
            col={col}
            series={series}
            plane={report.basis.plane}
            isTarget={isTarget}
          />
        </div>
      )}
    </li>
  )
}
