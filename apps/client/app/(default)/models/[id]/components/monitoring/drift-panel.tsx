'use client'

import { Badge } from '@/components/ui/badge'
import type { DriftReport } from '@/services/model-monitoring'
import { DRIFT_STATUS_CLASS as STATUS_CLASS } from '@/lib/drift-status-style'

interface Props {
  report: DriftReport | null
  loading: boolean
  unavailableReason: string | null
}

/**
 * MODEL-SERVE-005-T02. Live input distribution vs. the PRODUCTION version's
 * own training distribution — z-score + estimated out-of-range rate per
 * column (see apps/backend/src/lib/prediction-drift.ts for the math).
 *
 * Status colors live in `lib/drift-status-style.ts` — hoisted there once
 * the Input Data tab's feature table became a second consumer of the same
 * palette; see that module for the rationale (not the red/amber
 * deploy-status vocabulary).
 */

function formatSigned(value: number, digits = 2): string {
  const s = value.toFixed(digits)
  return value > 0 ? `+${s}` : s
}

export function DriftPanel({ report, loading, unavailableReason }: Props) {
  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        Loading drift report…
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
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        No sampled predictions in this range to compare.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {report.basis.sampleRequests} sampled request
          {report.basis.sampleRequests === 1 ? '' : 's'} vs. version{' '}
          {report.basis.version}&apos;s training distribution
        </span>
        <Badge className={`border-0 ${STATUS_CLASS[report.status]}`}>
          {report.status}
        </Badge>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Column</th>
              <th className="px-3 py-2 text-right font-medium">z-score</th>
              <th className="px-3 py-2 text-right font-medium">
                Out-of-range (est.)
              </th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {report.columns.map(col => (
              <tr key={col.column} className="border-t border-border">
                <td className="px-3 py-2 font-mono">{col.column}</td>
                <td className="px-3 py-2 text-right font-mono">
                  {col.z === null ? '—' : formatSigned(col.z)}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {col.outOfRangePct === null
                    ? '—'
                    : `${col.outOfRangePct.toFixed(1)}%`}
                </td>
                <td className="px-3 py-2">
                  <Badge
                    className={`border-0 ${STATUS_CLASS[col.status]}`}
                    title={col.reason}
                  >
                    {col.status}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
