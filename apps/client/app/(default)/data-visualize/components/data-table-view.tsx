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

/**
 * Two sticky axes, so three z-layers are needed rather than two: the corner
 * cell is sticky on BOTH and must sit above the header row and the timestamp
 * column, or a horizontally-scrolled tag header slides over it.
 *
 * Every sticky cell needs an OPAQUE background of its own — a sticky element
 * with a transparent background shows the scrolling content straight through
 * it. `bg-card`/`bg-background` here are load-bearing, not decoration.
 */
const STICKY_CORNER = 'sticky left-0 top-0 z-30 bg-card'
const STICKY_HEADER = 'sticky top-0 z-20 bg-card'
const STICKY_FIRST_COL = cn(
  'sticky left-0 z-10',
  'before:absolute before:inset-0 before:-z-10 before:bg-background before:content-[""]',
  'group-hover:bg-muted/50',
)

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
    <div className="h-90 w-full overflow-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="bg-card hover:bg-card">
            <TableHead className={cn(STICKY_CORNER, 'border-r border-border')}>
              Timestamp
            </TableHead>
            {dataset.tags.map(t => {
              const m = tagMeta(t)
              return (
                <TableHead
                  key={t}
                  className={cn(STICKY_HEADER, 'whitespace-nowrap text-right')}
                >
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
            <TableRow key={row.timestamp} className="group">
              {/* `group-hover:bg-muted/50` mirrors TableRow's own hover: a
                  sticky cell with an opaque background would otherwise stay
                  unhighlighted while the rest of its row changes colour. */}
              <TableCell
                className={cn(
                  STICKY_FIRST_COL,
                  'whitespace-nowrap border-r border-border font-mono text-xs text-muted-foreground',
                  'group-hover:bg-muted/50',
                )}
              >
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
    </div>
  )
}
