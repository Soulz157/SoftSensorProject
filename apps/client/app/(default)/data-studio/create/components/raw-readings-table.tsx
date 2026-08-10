'use client'

import { useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '@/lib/utils'
import { tagMeta, type SensorQuality } from '@/lib/mock-readings'
import type { Dataset, ScalerMethod } from '@/lib/preprocessing'
import { badDataByTag } from '@/lib/data-quality'
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

// Fixed pixel sizes, matching the previous `w-44`/`w-40` Tailwind widths and
// the previous two-line header's rendered height — TanStack Virtual needs a
// number to estimate offsets before anything paints. `ROW_HEIGHT` is a
// starting estimate only; the row virtualizer below is wired to
// `measureElement` so it self-corrects against each row's real rendered
// height instead of trusting this guess forever.
const TIMESTAMP_COL_WIDTH = 176
const TAG_COL_WIDTH = 160
const HEADER_HEIGHT = 52
const ROW_HEIGHT = 32
// Render a few extra rows/columns past the viewport edge so a fast scroll
// doesn't show a blank flash before the next batch paints.
const OVERSCAN = 6

/**
 * Pivot raw readings — one row per timestamp, one value column per tag.
 *
 * DS-LAKE-005B-B-T02: BOTH axes are virtualized with `@tanstack/react-virtual`
 * — with 8,000 tags the horizontal axis is exactly as unbounded as the
 * vertical one (dataset.tags.length columns × dataset.rows.length rows is a
 * literal O(tags × rows) DOM node count with no windowing), so this is not
 * "virtualize rows, tags are fine". The native `<table>`/shadcn `Table`
 * primitives are NOT used here on purpose: virtualizing individual `<tr>`/
 * `<td>` cells inside a real `<table>` breaks table layout (rows must all be
 * present for the browser to size columns correctly), which is why every
 * mainstream virtualization library recommends a div-based grid with ARIA
 * table roles instead — this file switches to that pattern, `components/ui/
 * table.tsx` itself is untouched.
 *
 * Timestamp column and header row stay pinned via CSS `position: sticky` on
 * the OUTER wrapper of each, same visual result as before; only the CELLS
 * inside them are now windowed instead of every one being mounted.
 */
export function RawReadingsTable({
  dataset,
  scalers,
}: {
  dataset: Dataset
  /** Per-tag scaler config — tags with an entry get a "transformed" badge. */
  scalers?: Record<string, ScalerMethod>
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  const badDataCount = useMemo(() => badDataByTag(dataset), [dataset])

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

  const rowVirtualizer = useVirtualizer({
    count: dataset.rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  })

  const columnVirtualizer = useVirtualizer({
    count: dataset.tags.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => TAG_COL_WIDTH,
    overscan: OVERSCAN,
    horizontal: true,
  })

  if (dataset.tags.length === 0 || dataset.rows.length === 0) {
    return (
      <div className="flex h-90 items-center justify-center rounded-lg border border-border text-sm text-muted-foreground">
        No rows to display
      </div>
    )
  }

  const virtualRows = rowVirtualizer.getVirtualItems()
  const virtualColumns = columnVirtualizer.getVirtualItems()

  return (
    <div
      ref={containerRef}
      role="table"
      aria-rowcount={dataset.rows.length + 1}
      aria-colcount={dataset.tags.length + 1}
      className="relative max-h-96 overflow-auto rounded-lg border border-border bg-background text-sm"
    >
      <div
        style={{
          position: 'relative',
          width: TIMESTAMP_COL_WIDTH + columnVirtualizer.getTotalSize(),
          height: HEADER_HEIGHT + rowVirtualizer.getTotalSize(),
        }}
      >
        {/* Header row — sticky top, timestamp header cell sticky left within it. */}
        <div
          role="row"
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 30,
            height: HEADER_HEIGHT,
            width: TIMESTAMP_COL_WIDTH + columnVirtualizer.getTotalSize(),
          }}
          className="bg-card"
        >
          <div
            role="columnheader"
            style={{
              position: 'sticky',
              left: 0,
              top: 0,
              zIndex: 31,
              width: TIMESTAMP_COL_WIDTH,
              height: HEADER_HEIGHT,
            }}
            className="flex items-end whitespace-nowrap border-b border-r border-border bg-card px-2 pb-1 font-medium"
          >
            Timestamp
          </div>
          {virtualColumns.map(vc => {
            const tag = dataset.tags[vc.index]!
            const m = tagMeta(tag)
            const st = tagStatus.get(tag)
            const badCount = badDataCount[tag] ?? 0
            return (
              <div
                key={vc.key}
                role="columnheader"
                style={{
                  position: 'absolute',
                  left: TIMESTAMP_COL_WIDTH + vc.start,
                  top: 0,
                  width: vc.size,
                  height: HEADER_HEIGHT,
                }}
                className="border-b border-border bg-card px-1 text-right align-bottom"
              >
                <div className="flex flex-col items-end gap-0.5 py-1">
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
                    <span className="truncate">{tag}</span>
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
                  <span className="truncate text-[11px] font-normal text-muted-foreground">
                    {m?.unit ? ` · ${m.unit}` : ''}
                  </span>
                </div>
              </div>
            )
          })}
        </div>

        {/* Body rows — each row absolutely positioned by the row virtualizer;
            each cell within a row absolutely positioned by the column
            virtualizer. Only visible rows × visible columns ever mount.
            `group-hover:bg-muted` on the cells still works even though the
            cells are position:absolute: `:hover` propagates to ancestors by
            DOM parentage, not visual containment, so any cell painted under
            the cursor still flags its `.group` row ancestor as hovered. */}
        {virtualRows.map(vr => {
          const row = dataset.rows[vr.index]!
          return (
            <div
              key={vr.key}
              ref={rowVirtualizer.measureElement}
              data-index={vr.index}
              role="row"
              style={{
                position: 'absolute',
                top: HEADER_HEIGHT + vr.start,
                left: 0,
                height: vr.size,
                width: TIMESTAMP_COL_WIDTH + columnVirtualizer.getTotalSize(),
              }}
              className="group"
            >
              <div
                role="cell"
                style={{
                  position: 'sticky',
                  left: 0,
                  zIndex: 10,
                  width: TIMESTAMP_COL_WIDTH,
                  height: vr.size,
                }}
                className="flex items-center whitespace-nowrap border-r border-border bg-background px-2 font-mono text-xs text-muted-foreground group-hover:bg-muted"
              >
                {formatTs(row.timestamp)}
              </div>
              {virtualColumns.map(vc => {
                const tag = dataset.tags[vc.index]!
                const cell = row.cells[tag]
                return (
                  <div
                    key={vc.key}
                    role="cell"
                    style={{
                      position: 'absolute',
                      left: TIMESTAMP_COL_WIDTH + vc.start,
                      top: 0,
                      width: vc.size,
                      height: vr.size,
                    }}
                    className="flex items-center justify-end px-1 group-hover:bg-muted"
                  >
                    {cell ? (
                      <span
                        title={String(cell.value)}
                        className="truncate font-mono text-xs tabular-nums text-foreground"
                      >
                        {cell.value}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground/50">
                        —
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
