'use client'

import { useMemo, useState, type CSSProperties } from 'react'
import { ChevronDown, GitCompareArrows, Grid3x3 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { pearsonMatrix, topCorrelations } from '@/lib/data-quality'
import type { Dataset } from '@/lib/preprocessing'

interface Props {
  dataset: Dataset
  /** |r| threshold for the "strong" highlight. Defaults to 0.8 (±80%). */
  threshold?: number
}

/** Warm (positive) / cool (negative) cell tint, opacity scaled by |r|. */
function cellStyle(r: number): CSSProperties {
  const mag = Math.min(1, Math.abs(r))
  const base = r >= 0 ? '16 185 129' /* emerald */ : '56 189 248' /* sky */
  return { backgroundColor: `rgb(${base} / ${(0.12 + mag * 0.6).toFixed(3)})` }
}

/**
 * Pearson correlation between fetched tags. Always shows the strongest
 * relationships (≥ threshold); the full heatmap is collapsed by default to
 * keep dense tag sets manageable. Pure display — numbers from `lib/data-quality`.
 */
export function CorrelationMatrix({ dataset, threshold = 0.8 }: Props) {
  const [open, setOpen] = useState(false)
  const matrix = useMemo(() => pearsonMatrix(dataset), [dataset])
  const top = useMemo(
    () => topCorrelations(matrix, threshold),
    [matrix, threshold],
  )

  if (dataset.tags.length < 2) return null

  const pct = (r: number) => `${(r * 100).toFixed(0)}%`

  return (
    <div className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-center gap-2">
        <GitCompareArrows className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">Data Correlation</p>
        <span className="ml-auto text-[11px] text-muted-foreground">
          Pearson · |r| ≥ {Math.round(threshold * 100)}% is strong
        </span>
      </div>

      {/* Top relationships (always visible) */}
      {top.length > 0 ? (
        <div className="space-y-1.5">
          {top.map(pair => (
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
                className={cn(
                  'shrink-0 font-mono text-sm font-semibold',
                  pair.r >= 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-sky-600 dark:text-sky-400',
                )}
              >
                {pair.r >= 0 ? '+' : ''}
                {pct(pair.r)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No tag pair reaches ±{Math.round(threshold * 100)}% correlation.
        </p>
      )}

      {/* Collapsible full heatmap */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-1 text-[11px]">
            <thead>
              <tr>
                <th className="sticky left-0 bg-card" />
                {matrix.tags.map(t => (
                  <th
                    key={t}
                    className="px-1 pb-1 text-center font-mono font-normal text-muted-foreground"
                  >
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.tags.map((rowTag, i) => (
                <tr key={rowTag}>
                  <th className="sticky left-0 bg-card pr-2 text-right font-mono font-normal text-muted-foreground">
                    {rowTag}
                  </th>
                  {matrix.tags.map((colTag, j) => {
                    const r = matrix.matrix[i]?.[j] ?? 0
                    const strong = i !== j && Math.abs(r) >= threshold
                    return (
                      <td
                        key={colTag}
                        className={cn(
                          'h-9 min-w-11 rounded text-center font-mono tabular-nums',
                          strong && 'font-semibold ring-2 ring-primary',
                        )}
                        style={i === j ? undefined : cellStyle(r)}
                        title={`${rowTag} ↔ ${colTag}: ${pct(r)}`}
                      >
                        {i === j ? (
                          <span className="text-muted-foreground/40">—</span>
                        ) : (
                          pct(r)
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
