'use client'

import type { ReactNode } from 'react'
import { formatMetricValue } from '@/lib/model-evaluation'
import type { MetricComparison } from '@/lib/retrain-metric-compare'
import { COMPARISON_VERDICT_CLASS } from '@/lib/retrain-verdict-style'
import { cn } from '@/lib/utils'

/** "New v4" / "Current v3" — or the bare role when the number is unknown,
 *  never "vnull". */
export function versionColumnLabel(
  role: 'New' | 'Current',
  version: number | null,
): string {
  return version !== null ? `${role} v${version}` : role
}

/**
 * One metric, the new and the current version side by side at the SAME
 * size, so the current figure reads as half of the comparison rather than
 * a footnote under the new one. The delta line says which side the
 * difference favours in words, and the ▲/▼ plus the verdict are coloured
 * green (better) / red (worse) — see `COMPARISON_VERDICT_CLASS` for why
 * that carve-out exists. The delta figure itself stays muted.
 *
 * The caller decides whether a delta may be shown at all (`comparison`
 * null = none): this card never compares two figures the server did not
 * call comparable.
 */
export function RetrainMetricCompareCard({
  label,
  newLabel,
  currentLabel,
  newValue,
  currentValue,
  newNotes,
  currentNotes,
  comparison,
  comparisonNote,
}: {
  label: string
  newLabel: string
  currentLabel: string
  /** `'pending'` renders an ellipsis while the figure is being scored. */
  newValue: number | null | 'pending'
  currentValue: number | null | 'pending'
  /** One line each, beneath the figure. */
  newNotes?: ReactNode[]
  currentNotes?: ReactNode[]
  comparison: MetricComparison | null
  /** Which figures the delta was taken from, e.g. "at lab events". */
  comparisonNote?: string
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md bg-muted/30 p-3 ring-1 ring-foreground/20">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Side title={newLabel} value={newValue} notes={newNotes} />
        <Side title={currentLabel} value={currentValue} notes={currentNotes} />
      </div>
      {comparison && (
        <p className="border-t border-border pt-1.5 text-[10px] text-muted-foreground">
          {comparison.verdict === 'same' ? (
            <span
              className={cn(
                'font-medium',
                COMPARISON_VERDICT_CLASS[comparison.verdict],
              )}
            >
              No change
            </span>
          ) : (
            <>
              <span className={COMPARISON_VERDICT_CLASS[comparison.verdict]}>
                {comparison.delta < 0 ? '▼' : '▲'}
              </span>{' '}
              <span className="tabular-nums">
                {formatMetricValue(Math.abs(comparison.delta))}
              </span>{' '}
              {comparison.delta < 0 ? 'lower' : 'higher'} —{' '}
              <span
                className={cn(
                  'font-medium',
                  COMPARISON_VERDICT_CLASS[comparison.verdict],
                )}
              >
                New {comparison.verdict}
              </span>
            </>
          )}
          {comparisonNote && ` (${comparisonNote})`}
        </p>
      )}
    </div>
  )
}

function Side({
  title,
  value,
  notes = [],
}: {
  title: string
  value: number | null | 'pending'
  notes?: ReactNode[]
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <p className="text-[10px] font-medium text-muted-foreground">{title}</p>
      <p className="text-lg font-semibold tabular-nums text-foreground">
        {value === 'pending' ? '…' : formatMetricValue(value)}
      </p>
      {notes.map((note, i) => (
        <p key={i} className="text-[10px] text-muted-foreground">
          {note}
        </p>
      ))}
    </div>
  )
}
