'use client'

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

interface Props {
  dataset: Dataset
  showQuality?: boolean
}

export function DataTableView({ dataset, showQuality }: Props) {
  if (dataset.rows.length === 0) {
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
            <TableHead className="sticky top-0 bg-card">Timestamp</TableHead>
            {dataset.tags.map(t => {
              const m = tagMeta(t)
              return (
                <TableHead key={t} className="sticky top-0 bg-card text-right">
                  {m?.label ?? t}
                  {m?.unit && (
                    <span className="ml-1 text-muted-foreground">{m.unit}</span>
                  )}
                </TableHead>
              )
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {dataset.rows.map(row => (
            <TableRow key={row.timestamp}>
              <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                {new Date(row.timestamp).toLocaleString()}
              </TableCell>
              {dataset.tags.map(t => {
                const cell = row.cells[t]
                return (
                  <TableCell
                    key={t}
                    className="text-right font-mono tabular-nums"
                  >
                    <span className="inline-flex items-center justify-end gap-1.5">
                      {showQuality && cell && (
                        <span
                          title={cell.status}
                          className={cn(
                            'h-1.5 w-1.5 shrink-0 rounded-full',
                            QUALITY_DOT[cell.status],
                          )}
                        />
                      )}
                      {cell ? cell.value : '—'}
                    </span>
                  </TableCell>
                )
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  )
}
