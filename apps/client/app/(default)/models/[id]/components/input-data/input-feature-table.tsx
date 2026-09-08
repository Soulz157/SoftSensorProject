'use client'

import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { DRIFT_STATUS_CLASS } from '@/lib/drift-status-style'
import type { InputFeatureRow } from '@/lib/model-input-features'

interface Props {
  rows: InputFeatureRow[]
}

function fmtValue(row: InputFeatureRow): string {
  if (row.lastValue !== null) {
    return row.lastValue.toLocaleString(undefined, {
      maximumFractionDigits: 4,
    })
  }
  if (row.lastValueScaled !== null) {
    // Could not be inverted to engineering units — show the scaled figure
    // rather than nothing, but never claim it is a real measurement.
    return `${row.lastValueScaled.toFixed(4)} (scaled)`
  }
  return '—'
}

function fmtLastSeen(iso: string | null): string {
  if (!iso) return 'never'
  return new Date(iso).toLocaleString()
}

/**
 * The X feature table for the Input Data tab — one row per trained
 * feature column, in predict-time order (`featureColumns` order, never
 * re-sorted). Every row renders even for a column with no logged traffic:
 * `driftStatus` is `UNKNOWN` and the value/seen columns show an em-dash —
 * this is the whole point of reading `featureColumns` rather than only the
 * most recent logged request.
 */
export function InputFeatureTable({ rows }: Props) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">#</TableHead>
          <TableHead>Feature</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Last value</TableHead>
          <TableHead className="text-right">Last seen</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody className="divide-y divide-border">
        {rows.map((row, i) => (
          <TableRow key={row.column}>
            <TableCell className="text-xs text-muted-foreground tabular-nums">
              {i + 1}
            </TableCell>
            <TableCell className="font-mono text-xs font-medium text-foreground">
              {row.column}
            </TableCell>
            <TableCell>
              <Badge
                className={`border-0 ${DRIFT_STATUS_CLASS[row.driftStatus]}`}
                title={row.driftReason}
              >
                {row.driftStatus}
              </Badge>
            </TableCell>
            <TableCell className="text-right font-mono text-xs tabular-nums text-foreground">
              {fmtValue(row)}
            </TableCell>
            <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
              {fmtLastSeen(row.lastSeen)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
