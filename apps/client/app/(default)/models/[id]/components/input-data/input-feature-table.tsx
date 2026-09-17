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
/** MODEL-SERVE-009-T03. A flat run reads as "4h12m", not "252m" — the
 *  numbers this shows are hours-to-days on a real plant, and minutes alone
 *  stop being legible past the first hour. Under an hour stays in minutes,
 *  where that is the natural unit. */
function formatFlatDuration(minutes: number): string {
  const whole = Math.floor(minutes)
  if (whole < 60) return `${whole}m`
  const h = Math.floor(whole / 60)
  const m = whole % 60
  return m === 0 ? `${h}h` : `${h}h${m}m`
}

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
          {/* MODEL-SERVE-009-T04. "Last seen" is ARRIVAL; "Last changed" is
              MOVEMENT. They are different questions and a stuck instrument
              is exactly the case where they diverge — a tag can arrive
              every minute for two days and not have moved once. Keeping
              one column would hide the only signal that says so. */}
          <TableHead className="text-right">Last seen</TableHead>
          <TableHead className="text-right">Last changed</TableHead>
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
              {/* MODEL-SERVE-001-T29/T30. A THIRD verdict, beside PI's — a
                  stuck instrument can report Good and un-drifted while its
                  value has not changed in hours, so neither neighbouring
                  badge can carry this.

                  AMBER (`Questionable`), never `Bad`/red: red already means
                  "PI itself calls this tag bad", and a tag that is reporting
                  cleanly but not moving is a different finding that wants a
                  different look. Tags flat in TRAINING are already excluded
                  server-side, so a setpoint never lands here. */}
              {row.frozen && (
                <Badge
                  className={`ml-1 border-0 ${PI_STATUS_CLASS.Questionable}`}
                  title={
                    // MODEL-SERVE-009-T03. The badge still comes from
                    // MODEL-SERVE-001-T29's three-window detection; the
                    // duration is EVIDENCE beside it, measured from the
                    // per-tag row's own timestamps rather than inferred
                    // from a pooled range. Unknown stays unstated — a
                    // missing per-tag row must not read as "just changed".
                    row.frozenFlatMinutes === null
                      ? "No movement across the schedule's last frozenWindows windows"
                      : `No movement across the schedule's last frozenWindows windows — unchanged for ${formatFlatDuration(row.frozenFlatMinutes)}`
                  }
                >
                  Frozen
                  {row.frozenFlatMinutes !== null && (
                    <span className="ml-1 font-normal opacity-80">
                      {formatFlatDuration(row.frozenFlatMinutes)}
                    </span>
                  )}
                </Badge>
              )}
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
            <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
              {row.lastChanged === null ? (
                // Em-dash, never a zero duration: no per-tag row yet is
                // UNKNOWN, and "0m" would claim the tag just changed.
                <span title="No scheduled fetch has recorded this tag yet">
                  —
                </span>
              ) : (
                <span
                  title={
                    row.lastFetchOutcome === 'FAILED'
                      ? // An absent fetch is not a flat tag: when the last
                        // fetch failed these timestamps are deliberately
                        // stale, and saying so stops a reader counting an
                        // outage as flatness.
                        `${fmtLastSeen(row.lastChanged)} — the last fetch FAILED, so this has not been rechecked`
                      : fmtLastSeen(row.lastChanged)
                  }
                >
                  {row.frozenFlatMinutes !== null
                    ? formatFlatDuration(row.frozenFlatMinutes)
                    : fmtLastSeen(row.lastChanged)}
                </span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
