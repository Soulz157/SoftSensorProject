'use client'

import type { ArtifactTagColumnStats } from '@/services/dataset-version'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

/**
 * Accepts nullish, mirroring `DatasetDetailSheet`'s own `fmt`. Every numeric
 * field in `column_stats.json` is optional at the source: min/max/mean/
 * median are null for a tag with zero Good cells, `std` is null below two,
 * and ALL of them are absent (undefined, not null) on a sidecar written
 * before per-tag statistics were captured. An em-dash is the honest
 * rendering of all three — `NaN` or `0.00` would each claim something false.
 */
function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

interface Props {
  stats: ArtifactTagColumnStats[]
  loading: boolean
  /** A 404 — the artifact predates the sidecar. A NORMAL state with its own
   * copy, not an error and not "this dataset has no tags". */
  missing: boolean
  error: string | null
}

/**
 * Per-tag statistics from the `column_stats.json` sidecar —
 * MODEL-FLOW-010-T04. Same three-way state `DatasetDetailSheet` already
 * proves: `loading` / `missing` (404, a normal legacy-artifact state) /
 * `error` (a transport failure, not an empty result). Collapsing those three
 * into two is the exact regression DS-LAKE-013-T03 already had to fix once.
 */
export function PerTagStatsPanel({ stats, loading, missing, error }: Props) {
  if (loading) {
    return (
      <div className="space-y-2 rounded-lg border border-border p-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    )
  }

  if (missing) {
    return (
      <p className="rounded-lg border border-border p-4 text-center text-xs text-muted-foreground">
        This artifact has no statistics sidecar — it was written before per-tag
        statistics were captured.
      </p>
    )
  }

  if (error) {
    return (
      <p className="rounded-lg border border-border p-4 text-center text-xs text-muted-foreground">
        Could not load statistics — {error}
      </p>
    )
  }

  if (stats.length === 0) {
    return (
      <p className="rounded-lg border border-border p-4 text-center text-xs text-muted-foreground">
        No statistics available for this artifact.
      </p>
    )
  }

  return (
    <ScrollArea className="h-56 rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="bg-card">
            <TableHead className="sticky top-0 bg-card">Tag</TableHead>
            <TableHead className="sticky top-0 bg-card text-right">
              Mean
            </TableHead>
            <TableHead className="sticky top-0 bg-card text-right">
              Median
            </TableHead>
            <TableHead className="sticky top-0 bg-card text-right">
              Max
            </TableHead>
            <TableHead className="sticky top-0 bg-card text-right">
              Min
            </TableHead>
            <TableHead className="sticky top-0 bg-card text-right">
              SD
            </TableHead>
            <TableHead className="sticky top-0 bg-card text-right">
              Coverage
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {stats.map(s => (
            <TableRow key={s.tag}>
              <TableCell className="font-mono text-foreground">
                {s.tag}
              </TableCell>
              <TableCell className="text-right font-mono">
                {fmt(s.mean)}
              </TableCell>
              <TableCell className="text-right font-mono">
                {fmt(s.median)}
              </TableCell>
              <TableCell className="text-right font-mono">
                {fmt(s.max)}
              </TableCell>
              <TableCell className="text-right font-mono">
                {fmt(s.min)}
              </TableCell>
              <TableCell className="text-right font-mono">
                {fmt(s.std)}
              </TableCell>
              <TableCell className="text-right font-mono">
                {fmt(s.coverage)}%
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  )
}
