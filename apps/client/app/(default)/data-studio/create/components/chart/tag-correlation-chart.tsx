'use client'

import { useState, type CSSProperties } from 'react'
import { ChevronDown, GitCompareArrows, Grid3x3 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { topCorrelations } from '@/lib/data-quality'
import type { DraftCorrelationResult } from '@/services/dataset-draft'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'

/**
 * DS-LAKE-005B-D-T07. Consumes the SERVER correlation response
 * (`correlation_matrix_service.py` via `DS-LAKE-005B-D-T05a`/`T05b`'s
 * near-constant-filtered, ranked, hard-capped column list + Pearson
 * matrix) — never the client `dataset`. `Dataset` is deliberately NOT
 * accepted here, same `DS-LAKE-005B-D-V05` type gate `TagHistogramChart`/
 * `TagBoxplotChart`/`TagScatterChart` apply.
 *
 * Rendering (color scale, legend, top-pairs list, collapsible full
 * heatmap) is carried over from the client-only `CorrelationMatrix`
 * (`chart/correlation-matrix.tsx`) it replaces in `DataAnalysisCard` — that
 * component had exactly one caller (`CorrelationHeatmap`, itself only used
 * by `DataAnalysisCard`), so it is left in place, unwired, rather than
 * retrofitted in place; `topCorrelations` (`lib/data-quality.ts`) is reused
 * as-is since it already operates on a `{ tags, matrix }` shape structurally
 * identical to `DraftCorrelationResult` — no duplicate ranking logic.
 *
 * `highlightTag` is intentionally not a prop here — `CorrelationMatrix`'s
 * own doc comment already recorded it as "accepted for API compatibility;
 * not yet rendered", so dropping it is not a behavior regression.
 *
 * `status` mirrors `TagHistogramChart`/`TagBoxplotChart`/`TagScatterChart`'s
 * exact union.
 */
interface Props {
  data: DraftCorrelationResult | null
  status: 'no-tags' | 'pending' | 'loading' | 'ready' | 'unavailable'
  /** |r| threshold for the "strong" highlight. Defaults to 0.8. */
  threshold?: number
}

const COLOR_STOPS: Array<[number, [number, number, number]]> = [
  [0.0, [103, 0, 31]], // #67001F (Correlation -1.0)
  [0.1, [178, 24, 43]], // #B2182B (Correlation -0.8)
  [0.2, [214, 96, 77]], // #D6604D (Correlation -0.6)
  [0.3, [244, 165, 130]], // #F4A582 (Correlation -0.4)
  [0.4, [253, 219, 199]], // #FDDBC7 (Correlation -0.2)
  [0.5, [247, 247, 247]], // #F7F7F7 (Correlation  0.0)
  [0.6, [209, 229, 240]], // #D1E5F0 (Correlation +0.2)
  [0.7, [146, 197, 222]], // #92C5DE (Correlation +0.4)
  [0.8, [67, 147, 195]], // #4393C3 (Correlation +0.6)
  [0.9, [33, 102, 172]], // #2166AC (Correlation +0.8)
  [1.0, [5, 48, 97]], // #053061 (Correlation +1.0)
]

function infernoRGB(t: number): [number, number, number] {
  const clamped = Math.min(1, Math.max(0, t))
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const [t0, c0] = COLOR_STOPS[i]!
    const [t1, c1] = COLOR_STOPS[i + 1]!
    if (clamped >= t0 && clamped <= t1) {
      const localT = t1 === t0 ? 0 : (clamped - t0) / (t1 - t0)
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * localT),
        Math.round(c0[1] + (c1[1] - c0[1]) * localT),
        Math.round(c0[2] + (c1[2] - c0[2]) * localT),
      ]
    }
  }
  return COLOR_STOPS[COLOR_STOPS.length - 1]![1]
}

function correlationColors(r: number): { bg: string; fg: string } {
  const t = (Math.max(-1, Math.min(1, r)) + 1) / 2
  const [rr, gg, bb] = infernoRGB(t)
  const luminance = 0.299 * rr + 0.587 * gg + 0.114 * bb
  return {
    bg: `rgb(${rr} ${gg} ${bb})`,
    fg: luminance > 150 ? '#1a1a1a' : '#f5f5f5',
  }
}

function cellStyle(r: number): CSSProperties {
  const { bg, fg } = correlationColors(r)
  return { backgroundColor: bg, color: fg }
}

const LEGEND_GRADIENT = `linear-gradient(to right, ${Array.from(
  { length: 21 },
  (_, i) => {
    const t = i / 20
    const [r, g, b] = infernoRGB(t)
    return `rgb(${r} ${g} ${b}) ${(t * 100).toFixed(0)}%`
  },
).join(', ')})`

function fmtR(r: number): string {
  return `${r >= 0 ? '+' : ''}${r.toFixed(2)}`
}

export function TagCorrelationChart({ data, status, threshold = 0.8 }: Props) {
  const [open, setOpen] = useState(false)

  if (status === 'no-tags') {
    return (
      <div className="flex h-80 flex-col items-center justify-center gap-2 text-center">
        <GitCompareArrows className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          Select at least two tags above.
        </p>
      </div>
    )
  }

  if (status === 'pending') {
    return (
      <div className="flex h-80 flex-col items-center justify-center gap-2 text-center">
        <GitCompareArrows className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          Save cleaned tags to build a correlation matrix.
        </p>
      </div>
    )
  }

  if (status === 'unavailable') {
    return (
      <div className="flex h-80 flex-col items-center justify-center gap-2 px-6 text-center">
        <GitCompareArrows className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          This dataset&apos;s raw artifact is no longer stored, so this chart
          has nothing to read. Apply a cleaning rule to create a new artifact
          from the loaded rows.
        </p>
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <div className="flex h-80 flex-col items-center justify-center gap-2 text-center">
        <GitCompareArrows className="h-8 w-8 animate-pulse text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          Loading correlation matrix…
        </p>
      </div>
    )
  }

  if (!data || data.tags.length < 2) {
    return (
      <div className="flex h-80 flex-col items-center justify-center gap-2 text-center">
        <GitCompareArrows className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">
          Not enough numeric tags to correlate.
        </p>
      </div>
    )
  }

  const top = topCorrelations(data, threshold)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <GitCompareArrows className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">Data Correlation</p>
        <span className="ml-auto text-[11px] text-muted-foreground">
          Pearson · |r| ≥ {threshold.toFixed(2)} is strong
        </span>
      </div>

      {data.near_constant_tags.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {data.near_constant_tags.length} near-constant tag
          {data.near_constant_tags.length > 1 ? 's' : ''} excluded from ranking.
        </p>
      )}

      <div className="space-y-1">
        <div
          className="h-2 w-full rounded-full ring-1 ring-foreground/10"
          style={{ background: LEGEND_GRADIENT }}
        />
        <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
          <span>-1.00</span>
          <span>-0.5</span>
          <span>0.00</span>
          <span>0.5</span>
          <span>+1.00</span>
        </div>
      </div>

      <div className="flex items-center justify-between pt-1">
        <h3 className="text-xs font-semibold text-foreground">
          Top Relationships
        </h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground">
          {top.length} pair{top.length !== 1 ? 's' : ''}
        </span>
      </div>

      {top.length > 0 ? (
        <ScrollArea className="w-full rounded-md [&>[data-radix-scroll-area-viewport]]:max-h-90">
          <div className="space-y-1.5 p-2">
            {top.map(pair => {
              const { bg, fg } = correlationColors(pair.r)
              return (
                <div
                  key={`${pair.a}-${pair.b}`}
                  className="flex items-center justify-between gap-3 rounded-lg bg-primary/5 px-3 py-2 ring-1 ring-primary/20"
                >
                  <div className="flex min-w-0 items-center gap-2 font-mono text-xs">
                    <span className="truncate text-foreground">{pair.a}</span>
                    <span className="text-muted-foreground">↔</span>
                    <span className="truncate text-foreground">{pair.b}</span>
                  </div>
                  <span
                    className="shrink-0 rounded-md px-2 py-1 font-mono text-sm font-semibold tabular-nums"
                    style={{ backgroundColor: bg, color: fg }}
                  >
                    {fmtR(pair.r)}
                  </span>
                </div>
              )
            })}
          </div>
        </ScrollArea>
      ) : (
        <p className="text-xs text-muted-foreground">
          No tag pair reaches ±{threshold.toFixed(2)} correlation.
        </p>
      )}

      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="cursor-pointer flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <Grid3x3 className="h-3.5 w-3.5" />
        {open ? 'Hide' : 'Show'} full heatmap
        <ChevronDown
          className={cn(
            'ml-auto h-4 w-4 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <TooltipProvider delayDuration={100}>
          <div className="relative isolate max-h-96 overflow-auto rounded-md border border-border">
            <table className="w-max border-separate border-spacing-0 text-[11px] [&_tr]:border-none">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead
                    style={{ position: 'sticky', left: 0, top: 0, zIndex: 30 }}
                    className="bg-card p-1"
                  />
                  {data.tags.map(t => (
                    <TableHead
                      key={t}
                      style={{ position: 'sticky', top: 0, zIndex: 20 }}
                      className="bg-card p-1"
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="mx-auto block w-16 cursor-help truncate text-center font-mono text-[10px] font-normal text-muted-foreground">
                            {t}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent
                          side="top"
                          className="font-mono text-xs"
                        >
                          {t}
                        </TooltipContent>
                      </Tooltip>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.tags.map((rowTag, i) => (
                  <TableRow
                    key={rowTag}
                    className="border-none hover:bg-transparent"
                  >
                    <TableHead
                      style={{ position: 'sticky', left: 0, zIndex: 10 }}
                      className="bg-card p-1 pr-2 text-right shadow-[1px_0_0_0_hsl(var(--border))]"
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="ml-auto block w-28 cursor-help truncate text-right font-mono text-[11px] font-normal text-muted-foreground">
                            {rowTag}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent
                          side="right"
                          className="font-mono text-xs"
                        >
                          {rowTag}
                        </TooltipContent>
                      </Tooltip>
                    </TableHead>
                    {data.tags.map((colTag, j) => {
                      const r = data.matrix[i]?.[j] ?? 0
                      const displayValue = i === j ? 1.0 : r
                      const strong = i !== j && Math.abs(r) >= threshold
                      return (
                        <TableCell
                          key={colTag}
                          className={cn(
                            'h-12 min-w-11 p-0.2 text-center font-mono tabular-nums',
                            strong && 'font-semibold',
                          )}
                          title={`${rowTag} ↔ ${colTag}: ${fmtR(r)}`}
                        >
                          <div
                            className="flex h-full w-full items-center justify-center"
                            style={cellStyle(displayValue)}
                          >
                            {fmtR(displayValue)}
                          </div>
                        </TableCell>
                      )
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
        </TooltipProvider>
      )}
    </div>
  )
}
