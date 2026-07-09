'use client'

import { useMemo } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { tagMeta, type SensorQuality } from '@/lib/mock-readings'
import type { Dataset } from '@/lib/preprocessing'

const QUALITY_DOT: Record<SensorQuality, string> = {
  Good: 'bg-emerald-500',
  Questionable: 'bg-amber-500',
  Bad: 'bg-red-500',
}

interface LongRow {
  key: string
  tagname: string
  value: number
  timestamp: string
  description: string
  status: SensorQuality
}

/**
 * Long-format raw readings table per the plan's Phase 3 spec — one row per
 * (tag, sample) with columns: Tag name · Value · Timestamp · Description.
 */
export function RawReadingsTable({ dataset }: { dataset: Dataset }) {
  const rows = useMemo<LongRow[]>(() => {
    const out: LongRow[] = []
    for (const row of dataset.rows) {
      for (const tag of dataset.tags) {
        const cell = row.cells[tag]
        if (!cell) continue
        out.push({
          key: `${tag}:${row.timestamp}`,
          tagname: tag,
          value: cell.value,
          timestamp: row.timestamp,
          description: tagMeta(tag)?.description ?? '—',
          status: cell.status,
        })
      }
    }
    return out
  }, [dataset])

  if (rows.length === 0) {
    return (
      <div className="flex h-90 items-center justify-center rounded-lg border border-border text-sm text-muted-foreground">
        No rows to display
      </div>
    )
  }

  return (
    <ScrollArea className="h-90 rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="bg-card">
            <TableHead className="sticky top-0 bg-card">Tag name</TableHead>
            <TableHead className="sticky top-0 bg-card text-right">
              Value
            </TableHead>
            <TableHead className="sticky top-0 bg-card">Timestamp</TableHead>
            <TableHead className="sticky top-0 bg-card">Description</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(r => {
            const m = tagMeta(r.tagname)
            return (
              <TableRow key={r.key}>
                <TableCell className="whitespace-nowrap font-mono text-xs font-medium text-foreground">
                  {r.tagname}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  <span className="inline-flex items-center justify-end gap-1.5">
                    <span
                      title={r.status}
                      className={cn(
                        'h-1.5 w-1.5 shrink-0 rounded-full',
                        QUALITY_DOT[r.status],
                      )}
                    />
                    {r.value}
                    {m?.unit && (
                      <span className="text-muted-foreground">{m.unit}</span>
                    )}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                  {new Date(r.timestamp).toLocaleString()}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {r.description}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </ScrollArea>
  )
}
