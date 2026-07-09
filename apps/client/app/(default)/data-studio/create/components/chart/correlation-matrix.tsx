'use client'

import { useMemo, useState, type CSSProperties } from 'react'
import { ChevronDown, GitCompareArrows, Grid3x3 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { pearsonMatrix, topCorrelations } from '@/lib/data-quality'
import type { Dataset } from '@/lib/preprocessing'

interface Props {
  dataset: Dataset
  /** |r| threshold for the "strong" highlight. Defaults to 0.8. */
  threshold?: number
  /** Accepted for API compatibility with callers; not yet rendered. */
  highlightTag?: string
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
// const COLOR_STOPS: Array<[number, [number, number, number]]> = [
//   [0.0, [51, 17, 255]], // สีน้ำเงินเข้ม (ค่าต่ำสุดประมาณ -2)
//   [0.1, [92, 70, 255]], // น้ำเงินสว่างขึ้น
//   [0.2, [133, 122, 255]], // น้ำเงินอมม่วงอ่อน
//   [0.3, [173, 173, 255]], // ฟ้า/ม่วงพาสเทล
//   [0.4, [214, 214, 255]], // ฟ้าอ่อนมากๆ ใกล้ขาว
//   [0.5, [255, 255, 255]], // สีขาว (จุดกึ่งกลาง ค่าประมาณ 0)
//   [0.6, [255, 214, 204]], // ชมพู/ส้มอ่อนมาก
//   [0.7, [255, 163, 143]], // ส้มพาสเทล
//   [0.8, [255, 112, 82]], // ส้มแดง
//   [0.9, [255, 61, 22]], // แดงสว่าง
//   [1.0, [220, 10, 0]], // สีแดงเข้ม (ค่าสูงสุดประมาณ 2)
// ]

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

/** r in [-1, 1] -> background + adaptive foreground text color, using the
 * full sequential scale (dark = strong negative, pale yellow = strong positive). */
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

/** Smooth horizontal gradient strip for the legend, sampled at 21 points. */
const LEGEND_GRADIENT = `linear-gradient(to right, ${Array.from(
  { length: 21 },
  (_, i) => {
    const t = i / 20
    const [r, g, b] = infernoRGB(t)
    return `rgb(${r} ${g} ${b}) ${(t * 100).toFixed(0)}%`
  },
).join(', ')})`

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

  /** Correlation coefficient formatted as a signed decimal on a 0–1 scale. */
  const fmt = (r: number) => `${r >= 0 ? '+' : ''}${r.toFixed(2)}`

  return (
    <div className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-center gap-2">
        <GitCompareArrows className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">Data Correlation</p>
        <span className="ml-auto text-[11px] text-muted-foreground">
          Pearson · |r| ≥ {threshold.toFixed(2)} is strong
        </span>
      </div>

      {/* Color scale legend, matching the reference sequential palette */}
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

      {/* Top relationships (always visible) */}
      {top.length > 0 ? (
        <div className="space-y-1.5">
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
                  {fmt(pair.r)}
                </span>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No tag pair reaches ±{threshold.toFixed(2)} correlation.
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
                          'h-16 min-w-11 text-center font-mono tabular-nums',
                          strong && 'font-semibold ',
                        )}
                        style={i === j ? undefined : cellStyle(r)}
                        title={`${rowTag} ↔ ${colTag}: ${fmt(r)}`}
                      >
                        {i === j ? (
                          <span className="text-muted-foreground/40">—</span>
                        ) : (
                          fmt(r)
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
