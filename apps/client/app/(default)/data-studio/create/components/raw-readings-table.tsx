'use client'

import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { tagMeta, type SensorQuality } from '@/lib/mock-readings'
import type { Dataset, ScalerMethod } from '@/lib/preprocessing'
import { useMemo } from 'react'
import { badDataByTag, rowQuality } from '@/lib/data-quality'
import { Info, WandSparkles } from 'lucide-react'

/** Short label for a scaler badge on transformed columns. */
const SCALER_LABEL: Record<ScalerMethod, string> = {
  minmax: 'Min-Max',
  standard: 'Z-Score',
  robust: 'Robust',
  none: '',
}

const QUALITY_DOT: Record<SensorQuality, string> = {
  Good: 'bg-emerald-500',
  Questionable: 'bg-amber-500',
  Bad: 'bg-red-500',
}

const QUALITY_RANK: Record<SensorQuality, number> = {
  Bad: 0,
  Questionable: 1,
  Good: 2,
}
function formatTs(ts: string) {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return d.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/**
 * Pivot raw readings — one row per timestamp, one value column per tag.
 * Timestamp column is frozen (sticky left) and the header row is frozen
 * (sticky top) using a SINGLE native overflow container so both axes pin
 * cleanly. `border-separate` is required for sticky cell borders to survive
 * scrolling (Tailwind Preflight sets border-collapse:collapse by default).
 */
export function RawReadingsTable({
  dataset,
  scalers,
}: {
  dataset: Dataset
  /** Per-tag scaler config — tags with an entry get a "transformed" badge. */
  scalers?: Record<string, ScalerMethod>
}) {
  const badDataCount = useMemo(() => {
    const badydata = badDataByTag(dataset)
    return badydata
  }, [dataset])

  const tagStatus = useMemo(() => {
    const status = new Map<string, SensorQuality | undefined>()
    for (const tag of dataset.tags) {
      let worst: SensorQuality | undefined
      for (const row of dataset.rows) {
        const cell = row.cells[tag]
        if (!cell) continue
        if (
          worst === undefined ||
          QUALITY_RANK[cell.status] > QUALITY_RANK[worst]
        ) {
          worst = cell.status
        }
      }
      status.set(tag, worst)
    }
    return status
  }, [dataset])
  if (dataset.tags.length === 0 || dataset.rows.length === 0) {
    return (
      <div className="flex h-90 items-center justify-center rounded-lg border border-border text-sm text-muted-foreground">
        No rows to display
      </div>
    )
  }

  return (
    <div className="relative max-h-96 overflow-auto rounded-lg border border-border">
      <Table className="min-w-max table-fixed caption-bottom border-separate border-spacing-0 text-sm">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead
              style={{ position: 'sticky', left: 0, top: 0, zIndex: 30 }}
              className="w-44 whitespace-nowrap border-b border-r border-border bg-card"
            >
              Timestamp
            </TableHead>
            {dataset.tags.map(tag => {
              const m = tagMeta(tag)
              const st = tagStatus.get(tag)
              const badCount = badDataCount[tag] ?? 0
              return (
                <TableHead
                  key={tag}
                  className="sticky top-0 z-20 w-40 border-b border-border bg-card text-right align-bottom"
                >
                  <div className="flex flex-col items-end gap-0.5 py-1">
                    <span className="font-mono text-xs font-semibold text-foreground">
                      <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-foreground">
                        {st && (
                          <span
                            title={st}
                            className={cn(
                              'h-1.5 w-1.5 shrink-0 rounded-full',
                              QUALITY_DOT[st],
                            )}
                          />
                        )}
                        {tag}
                        {badCount > 0 && (
                          <span className="ml-1.5 inline-flex items-center gap-1 rounded bg-purple-100 py-0.5 text-[10px] font-medium text-purple-700">
                            {badCount}
                            <Info className="h-3 w-3 shrink-0 text-purple-700" />
                          </span>
                        )}
                        {scalers?.[tag] && scalers[tag] !== 'none' && (
                          <span
                            title={`Feature transform: ${SCALER_LABEL[scalers[tag]]} scaler`}
                            className="ml-1.5 inline-flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                          >
                            <WandSparkles className="h-3 w-3 shrink-0" />
                            {SCALER_LABEL[scalers[tag]]}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="truncate text-[11px] font-normal text-muted-foreground">
                      {/* {m?.description ?? '—'} */}
                      {m?.unit ? ` · ${m.unit}` : ''}
                    </span>
                  </div>
                </TableHead>
              )
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {dataset.rows.map(row => (
            <TableRow key={row.timestamp} className="group">
              <TableCell className="sticky left-0 z-10 w-44 whitespace-nowrap border-r border-border bg-background font-mono text-xs text-muted-foreground group-hover:bg-muted">
                {formatTs(row.timestamp)}
              </TableCell>
              {dataset.tags.map(tag => {
                const cell = row.cells[tag]
                if (!cell) {
                  return (
                    <TableCell
                      key={tag}
                      className="text-right text-xs text-muted-foreground/50"
                    >
                      —
                    </TableCell>
                  )
                }
                return (
                  <TableCell
                    key={tag}
                    title={String(cell.value)}
                    className="truncate text-right font-mono text-xs tabular-nums text-foreground"
                  >
                    {cell.value}
                  </TableCell>
                )
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
