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
import { PI_STATUS_CLASS } from '@/lib/pi-status-style'
import type { InputFeatureRow } from '@/lib/model-input-features'

interface Props {
  rows: InputFeatureRow[]
}

function fmtValue(row: InputFeatureRow): string {
  // T12. `lastValueRaw` is the /predict request's own value — already
  // engineering units, no inversion, no second "(scaled)" branch. See
  // `lib/model-input-features.ts`'s own doc comment for why.
  if (row.lastValueRaw !== null) {
    return row.lastValueRaw.toLocaleString(undefined, {
      maximumFractionDigits: 4,
    })
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
          {/* T12. This column reports DRIFT (OK/WARN/CRITICAL/UNKNOWN vs.
              training distribution), never per-tag data quality — the old
              "Status" header let a reader reasonably mistake one for the
              other. The `/predict` stream carries no per-tag Good/Bad at
              all (see input-data-tab.tsx's own note above the table). */}
          <TableHead>Drift</TableHead>
          {/* MODEL-SERVE-001-T15. PI's OWN quality flag, read live — a
              different question from Drift, and the one an operator opens
              this tab to ask. For a derived feature it is its source tags'
              verdict, with the failing ones named. */}
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
              {/* T12. The equation behind a derived (formula) feature, under
                  its name — names which SOURCE COLUMNS feed it, never which
                  one is Bad (no per-tag status exists on this stream).
                  Absent entirely for a base tag, no placeholder row. */}
              {row.equation && (
                <div className="mt-0.5 font-mono text-[10px] font-normal text-muted-foreground">
                  {row.equation}
                </div>
              )}
            </TableCell>
            <TableCell>
              <Badge
                className={`border-0 ${DRIFT_STATUS_CLASS[row.driftStatus]}`}
                title={row.driftReason}
              >
                {row.driftStatus}
              </Badge>
            </TableCell>
            <TableCell>
              <Badge
                className={`border-0 ${PI_STATUS_CLASS[row.piStatus]}`}
                title={row.piReason}
              >
                {row.piStatus}
              </Badge>
              {/* The actionable half for a derived feature: WHICH source
                  tag is not Good. "Bad" alone says nothing at six sources. */}
              {row.failingSources && row.failingSources.length > 0 && (
                <div className="mt-0.5 font-mono text-[10px] font-normal text-muted-foreground">
                  via {row.failingSources.join(', ')}
                </div>
              )}
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
