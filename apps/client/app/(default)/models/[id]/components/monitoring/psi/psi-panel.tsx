'use client'

import { Fragment, useState } from 'react'
import { format } from 'date-fns'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type {
  PsiColumn,
  PsiReport,
  PsiStatus,
} from '@/services/model-monitoring'
import { PSI_STATUS_CLASS } from '@/lib/drift-status-style'
import { PsiBinChart } from './psi-bin-chart'
import { PsiBinTable } from './psi-bin-table'

interface Props {
  report: PsiReport | null
  loading: boolean
  unavailableReason: string | null
}

const COLUMN_COUNT = 5

function formatPsi(value: number): string {
  return value.toFixed(3)
}

/** `continuous` -> "quantile", matching T13's own vocabulary (the worked
 *  example calls its edges "10 frozen quantile bins"; `psi.py` calls the
 *  same edges "quantile boundaries"). Never the raw enum value on screen —
 *  a reader outside this codebase has no reason to know `binMode`. */
function binModeLabel(mode: 'continuous' | 'categorical'): string {
  return mode === 'continuous' ? 'quantile' : 'categorical'
}

/** `INSUFFICIENT_DATA` reads as "Insufficient data" per T13's own DISPLAY
 *  SPEC wording; every other status keeps the raw token, matching the
 *  z-score table's existing convention (`DriftPanel` prints `col.status`
 *  as-is) — this is the ONE status this table renders in prose rather than
 *  as a bare enum, because T13 quotes that exact phrase. */
function psiStatusLabel(status: PsiStatus): string {
  return status === 'INSUFFICIENT_DATA' ? 'Insufficient data' : status
}

function formatWindow(fromIso: string, toIso: string): string {
  try {
    return `${format(new Date(fromIso), 'MMM d, HH:mm')}–${format(new Date(toIso), 'HH:mm')}`
  } catch {
    return `${fromIso} – ${toIso}`
  }
}

/**
 * MODEL-SERVE-001-T13/T16. Level 1 of T13's own chosen display spec — a
 * SEPARATE card from the z-score table, never a column inside it (T13
 * explicitly REJECTED that shape: adjacent colour-coded Status columns
 * with different threshold vocabularies — z's +/-1.5/+/-3 SD vs. PSI's
 * 0.1/0.25 — assert a comparability that does not exist).
 *
 * Its own three-rung ladder (loading / unavailableReason / empty),
 * INDEPENDENT of the z-score's — the structural defect this rebuild fixes:
 * the previous merged `DriftPanel` gated a perfectly good PSI report behind
 * the Z-SCORE's own empty states, so a model with drift data but no
 * histogram-carrying traffic (or vice versa) could not show PSI at all.
 *
 * "Computed over" replaces T13's literal "rolling 24h" instruction (which
 * would print a FALSE cadence here — this hook fetches PSI over the SAME
 * `[from, to]` as the z-score, not a fixed rolling 24h window; see
 * `use-prediction-monitoring.ts`'s own doc comment) with the REAL window
 * from `basis.from`/`basis.to`, satisfying T13's actual intent — a reader
 * must not have to INFER the cadence — without asserting one the system
 * does not have.
 */
export function PsiPanel({ report, loading, unavailableReason }: Props) {
  const [expandedColumn, setExpandedColumn] = useState<string | null>(null)

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        Loading PSI report…
      </div>
    )
  }

  if (unavailableReason) {
    return (
      <div className="flex h-32 flex-col items-center justify-center gap-1 text-center text-sm text-muted-foreground">
        <p>{unavailableReason}</p>
      </div>
    )
  }

  if (!report || report.columns.length === 0) {
    return (
      <div className="flex h-32 flex-col items-center justify-center gap-1 px-6 text-center">
        <p className="text-sm text-muted-foreground">
          No PSI-eligible /predict traffic in this range.
        </p>
        <p className="text-xs text-muted-foreground/70">
          PSI reads each request&apos;s own bucketed feature histogram, recorded
          per row since this metric shipped. A request logged before that — or
          served under a spec with no frozen bins — carries none; the z-score
          above still covers it.
        </p>
      </div>
    )
  }

  const windowLabel = formatWindow(report.basis.from, report.basis.to)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {report.basis.histogramRequests} of {report.basis.sampleRequests}{' '}
          sampled request
          {report.basis.sampleRequests === 1 ? '' : 's'} carried a histogram,
          vs. version {report.basis.version}&apos;s frozen bins
        </span>
        <Badge className={`border-0 ${PSI_STATUS_CLASS[report.status]}`}>
          {psiStatusLabel(report.status)}
        </Badge>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Tag</th>
              <th className="px-3 py-2 text-right font-medium">PSI</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Bins used</th>
              <th className="px-3 py-2 text-right font-medium">
                Computed over
              </th>
            </tr>
          </thead>
          <tbody>
            {report.columns.map(col => {
              const canExpand =
                col.bins !== null && col.status !== 'INSUFFICIENT_DATA'
              const isOpen = expandedColumn === col.column

              return (
                <PsiRow
                  key={col.column}
                  col={col}
                  canExpand={canExpand}
                  isOpen={isOpen}
                  windowLabel={windowLabel}
                  histogramRequests={report.basis.histogramRequests}
                  sampleRequests={report.basis.sampleRequests}
                  onToggle={() =>
                    setExpandedColumn(c =>
                      c === col.column ? null : col.column,
                    )
                  }
                />
              )
            })}
          </tbody>
        </table>
      </div>
      {/* T13 cost (c): the 0.1/0.25 thresholds are CONVENTIONAL
          credit-scoring cutoffs, never measured against this plant's own
          process data — read from `basis.thresholds` (env-derived) rather
          than a literal, so this text can never silently drift from what
          `computePsi` was actually called with. T13 cost (b): the epsilon
          substituted for a zero bin proportion must be STATED, never
          hidden in a constant. */}
      <p className="text-[11px] text-muted-foreground/70">
        PSI thresholds ({report.basis.thresholds.warn} warn /{' '}
        {report.basis.thresholds.critical} critical) are conventional cutoffs,
        not measured against this plant&apos;s own data. A zero-proportion bin
        is floored at {report.basis.epsilon} before comparison.
      </p>
    </div>
  )
}

function PsiRow({
  col,
  canExpand,
  isOpen,
  windowLabel,
  histogramRequests,
  sampleRequests,
  onToggle,
}: {
  col: PsiColumn
  canExpand: boolean
  isOpen: boolean
  windowLabel: string
  histogramRequests: number
  sampleRequests: number
  onToggle: () => void
}) {
  return (
    <Fragment>
      <tr
        className={cn(
          'border-t border-border',
          canExpand && 'cursor-pointer hover:bg-muted/30',
        )}
        onClick={canExpand ? onToggle : undefined}
      >
        <td className="px-3 py-2 font-mono">
          <span className="inline-flex items-center gap-1">
            {canExpand &&
              (isOpen ? (
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
              ))}
            {col.column}
          </span>
        </td>
        <td className="px-3 py-2 text-right font-mono">
          {col.psi === null ? '—' : formatPsi(col.psi)}
        </td>
        <td className="px-3 py-2">
          <Badge
            className={`border-0 ${PSI_STATUS_CLASS[col.status]}`}
            title={col.reason}
          >
            {psiStatusLabel(col.status)}
          </Badge>
          {/* First-class INSUFFICIENT_DATA readout — rows-vs-floor, never a
              bare badge with no shape to it. T13: publish "insufficient
              data", never a numeric PSI computed from too few samples. */}
          {col.status === 'INSUFFICIENT_DATA' && col.bins && (
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              {col.liveTotal} of {col.bins.minSamples} rows
            </div>
          )}
        </td>
        <td className="px-3 py-2 text-right font-mono">
          {col.bins
            ? `${col.bins.binCount} (${binModeLabel(col.bins.binMode)})`
            : '—'}
        </td>
        <td className="px-3 py-2 text-right">
          <div className="font-mono text-[11px] leading-tight">
            {windowLabel}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {histogramRequests} of {sampleRequests} reqs
          </div>
        </td>
      </tr>
      {canExpand && isOpen && col.bins && (
        <tr className="hover:bg-transparent">
          <td colSpan={COLUMN_COUNT} className="bg-muted/20 p-0">
            <div className="space-y-3 px-4 py-3">
              <PsiBinChart bins={col.bins} liveTotal={col.liveTotal} />
              <PsiBinTable bins={col.bins} liveTotal={col.liveTotal} />
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  )
}
