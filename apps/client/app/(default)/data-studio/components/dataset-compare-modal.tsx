'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  LineChart as LineChartIcon,
  RotateCcw,
  Table2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { chartColorVar, resolveTagMeta } from '@/lib/mock-readings'
import type { Cell, Dataset } from '@/lib/preprocessing'
import { inverseScale, isInvertible } from '@/lib/inverse-scale'
import type {
  ArtifactHoldout,
  ArtifactScalingParams,
} from '@/services/dataset-version'
import { useArtifactFeatureSpec } from '@/hooks/dataset/artifact/use-artifact-feature-spec'
import { useArtifactRows } from '@/hooks/dataset/artifact/use-artifact-rows'
import {
  useArtifactValidationRows,
  COMPARE_ROWS,
} from '@/hooks/dataset/artifact/use-artifact-validation-rows'
import { RawReadingsTable } from '../create/components/raw-readings-table'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts'

/** Caps selection at the design system's fixed categorical chart palette
 * (`--chart-1` … `--chart-5`, docs/DESIGN_SYSTEM.md) — a 6th tag would need
 * a generated hue, which the palette is deliberately fixed-order to avoid.
 * Outside single-tag overlay mode, colour carries the TAG and stroke style
 * carries the SIDE, so one tag costs one colour rather than two. */
const MAX_TAGS = 5

const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 11 }

/** Validation columns are suffixed so each side is its OWN recharts series —
 * same tag, two dataKeys. That is what lets the two carry different stroke
 * styles and colours, and it stops recharts bridging one side's last point
 * straight to the other's first. */
const VAL_SUFFIX = '__val'

/** OVERLAY MODE COLOURS BY SIDE, so the two lines read as two populations
 * rather than two tags. That only works while ONE tag is selected — colour
 * has one dimension and cannot carry tag and side at once. With more than
 * one tag, colour falls back to the tag and the dash carries the side,
 * exactly as timeline mode does. */
const TRAIN_COLOR = 'var(--chart-1)'
const VAL_COLOR = 'var(--chart-4)'

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
/** Calendar months vary; this is only a TICK SPACING, never a date
 * calculation, so a fixed 30-day approximation is correct here — labels are
 * formatted from each tick's own real timestamp, not from this constant. */
const MONTH_MS = 30 * DAY_MS

/**
 * User-selectable tick granularity for TIMELINE mode.
 *
 * 'auto' walks the whole ladder. The three explicit units exist because the
 * automatic choice optimises for tick COUNT, and a short fetch — a few hours
 * of 1-minute rows — is exactly the case where the reader wants hour-level
 * detail whatever the count says. Naming the unit is the user overriding
 * that heuristic.
 *
 * OVERLAY MODE HAS NO GRANULARITY CHOICE. Its axis is a row index, not a
 * clock, so there is nothing for hour/day/month to select between.
 */
type TickUnit = 'auto' | 'hour' | 'day' | 'month'

/**
 * Multiples within each unit, smallest first. A unit choice is NOT a promise
 * of one tick per hour: on a year-long span that would be thousands of
 * labels. The unit fixes the FAMILY and the label format; the multiple is
 * then the smallest in that family that keeps the axis readable, so 'Hr' on
 * a long dataset lands on 12h rather than degenerating into noise or
 * silently jumping to days.
 */
const UNIT_STEPS: Record<Exclude<TickUnit, 'auto'>, number[]> = {
  hour: [HOUR_MS, 2 * HOUR_MS, 3 * HOUR_MS, 6 * HOUR_MS, 12 * HOUR_MS],
  day: [DAY_MS, 2 * DAY_MS, 7 * DAY_MS, 14 * DAY_MS],
  month: [MONTH_MS, 3 * MONTH_MS, 6 * MONTH_MS, 12 * MONTH_MS],
}

/** The automatic ladder, floored at TWO HOURS — below that a tick per point
 * is likelier than a tick per interval on any realistic fetch. */
const AUTO_STEPS_MS = [
  2 * HOUR_MS,
  4 * HOUR_MS,
  6 * HOUR_MS,
  12 * HOUR_MS,
  DAY_MS,
  2 * DAY_MS,
  7 * DAY_MS,
  14 * DAY_MS,
  MONTH_MS,
  3 * MONTH_MS,
  12 * MONTH_MS,
]
const MAX_TICKS = 8

type CompareAxis = 'time' | 'overlay'

type SeriesPoint = { t: number } & Record<string, number | null>

/** What both merge functions return. Shared shape so the caller never has to
 * branch on the mode to read the result. */
interface MergedSeries {
  points: SeriesPoint[]
  /** Absolute timestamp per ordinal position — TIMELINE mode only, empty in
   * overlay (whose x IS the row number and needs no lookup). The timeline
   * axis needs this because recharts' `tickFormatter` receives the value
   * alone and cannot reach the point the value came from. */
  labels: number[]
  /** Ordinal position where the validation side starts — timeline only. */
  boundaryIndex: number | null
}

/** Non-Good cells become `null`, not the stored numeric value — a Bad
 * reading is 0.0 in the parquet (same rule the detail sheet's Export
 * section documents: "a Bad reading exports as a blank cell"), and plotting
 * that 0 would read as a real dip in a tag that normally runs far from
 * zero. */
function goodValue(cell: Cell | undefined): number | null {
  return cell && cell.status === 'Good' ? cell.value : null
}

/**
 * DS-LAKE-025-T06. `invert` un-scales each Good value back to engineering
 * units; pass `null` for a side that is already raw.
 *
 * THE TWO SIDES ARE NOT IN THE SAME UNIT SPACE ON DISK. The train artifact
 * (FINAL -> GOLD) is post-`to_model_ready`, min-max scaled to [0,1] by
 * default. The holdout sidecar is NOT: `artifact_service.py` states
 * `validate_frame` "stays raw/unscaled until `prepare_holdout_for_run`".
 * With both sides on one axis — and especially when they OVERLAP — an
 * un-inverted train side would sit as a flat sliver on the axis floor
 * directly beneath the validation line and read as a catastrophic process
 * change. So the train side is inverted and the validation side is passed
 * through.
 */
function toSeries(
  sample: Dataset | null,
  tags: string[],
  invert: Record<string, ArtifactScalingParams> | null,
): SeriesPoint[] {
  if (!sample) return []
  return sample.rows.map(row => {
    const point = { t: new Date(row.timestamp).getTime() } as SeriesPoint
    for (const tag of tags) {
      const good = goodValue(row.cells[tag])
      point[tag] = invert ? inverseScale(good, invert[tag]) : good
    }
    return point
  })
}

/**
 * The Raw Table counterpart to `toSeries`. Cannot reuse it: `RawReadingsTable`
 * needs the full {timestamp, cells:{tag:{value,status}}} shape, and STATUS
 * MUST SURVIVE — a Bad cell stays Bad carrying its stored value, because the
 * table renders status as its own signal rather than collapsing to null the
 * way a line must. Nulling here would make a Bad reading indistinguishable
 * from a tag that is absent.
 */
function inverseDataset(
  sample: Dataset | null,
  params: Record<string, ArtifactScalingParams> | null,
): Dataset | null {
  if (!sample) return null
  if (!params) return sample
  return {
    ...sample,
    rows: sample.rows.map(row => ({
      ...row,
      cells: Object.fromEntries(
        Object.entries(row.cells).map(([tag, cell]) => {
          if (cell.status !== 'Good') return [tag, cell]
          const v = inverseScale(cell.value, params[tag])
          // A tag with no recorded fit keeps its stored value rather than
          // being nulled — `plottableTags` already excludes those from
          // selection, so reaching this branch means the tag was never
          // selectable and is not on screen.
          return [tag, v === null ? cell : { ...cell, value: v }]
        }),
      ),
    })),
  }
}

const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v)

function fmtNum(n: number | null): string {
  return n === null
    ? '—'
    : n.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

/**
 * Timeline: the two sides adjacent, ordered by date.
 *
 * X IS AN ORDINAL POSITION, NOT A CLOCK. Each side is capped at
 * COMPARE_ROWS from its OWN start, so on a real time scale the two sit at
 * opposite ends of the fetch window with a large empty stretch between them.
 * That stretch is the row cap, not missing data, and it dominated the chart.
 * Plotting sorted POSITION instead closes it while keeping the two sides in
 * true date order; the real timestamp rides along as `__t` for the ticks and
 * the tooltip.
 *
 * The cost is that distance along X no longer measures elapsed time — a
 * three-month gap and a one-minute gap occupy the same width. Same technique
 * a trading chart uses to skip weekends, and the reason the caption states
 * it outright.
 */
function mergeByTime(
  train: SeriesPoint[],
  validation: SeriesPoint[],
  tags: string[],
): MergedSeries {
  type Row = { t: number; side: 'train' | 'val'; src: SeriesPoint }
  const rows: Row[] = [
    ...train.map(p => ({ t: p.t, side: 'train' as const, src: p })),
    ...validation.map(p => ({ t: p.t, side: 'val' as const, src: p })),
  ]
  // Sorted by real date. Nothing guarantees the arrays arrive in order, and
  // the order IS the thing this mode exists to show.
  rows.sort((a, b) => a.t - b.t)

  const points: SeriesPoint[] = []
  const labels: number[] = []
  let boundaryIndex: number | null = null

  rows.forEach((row, i) => {
    labels.push(row.t)
    const point = { t: i, __t: row.t } as SeriesPoint
    for (const tag of tags) {
      // Only the side this row belongs to carries a value; the other stays
      // undefined so its line BREAKS here rather than bridging across.
      point[row.side === 'train' ? tag : tag + VAL_SUFFIX] = row.src[tag]
    }
    if (boundaryIndex === null && row.side === 'val') boundaryIndex = i
    points.push(point)
  })

  return { points, labels, boundaryIndex }
}

/**
 * Overlay: aligned by ROW INDEX from each side's own start, which is the
 * only way to put two time-CONTIGUOUS windows on top of each other. The two
 * sides do not overlap in time — validation is the tail cut at
 * `validationHoldoutFrom` — so superimposing them means giving up the clock.
 *
 * THE X AXIS IS A ROW NUMBER, NOT A CLOCK OF ANY KIND. Index i holds train's
 * i-th row AND validation's i-th row, which are two different moments, so
 * both timestamps are carried per point for the TOOLTIP to name and neither
 * appears on the axis. The holdout boundary has no position here either —
 * both sides start at 0. This is a shape comparison; anything that reads as
 * "when" belongs to timeline mode, and each side's real window is stated
 * under its own legend.
 */
function mergeByIndex(
  train: SeriesPoint[],
  validation: SeriesPoint[],
  tags: string[],
): MergedSeries {
  const len = Math.max(train.length, validation.length)
  const points: SeriesPoint[] = []
  for (let i = 0; i < len; i += 1) {
    const a = train[i]
    const b = validation[i]
    const point = { t: i } as SeriesPoint
    // Each side's real timestamp, for the tooltip only — never plotted.
    if (a) point.__trainT = a.t
    if (b) point.__valT = b.t
    for (const tag of tags) {
      point[tag] = a ? (a[tag] ?? null) : null
      point[tag + VAL_SUFFIX] = b ? (b[tag] ?? null) : null
    }
    points.push(point)
  }
  // No per-position date and no boundary: x is already the value the axis
  // shows, so there is nothing to look up.
  return { points, labels: [], boundaryIndex: null }
}

/**
 * Step size in ms for the requested granularity over `span`.
 *
 * 'auto' takes the smallest rung of the full ladder that fits MAX_TICKS. A
 * named unit stays INSIDE its own family: the smallest multiple that fits,
 * or the largest multiple if none does. That last case is deliberate — 'Hr'
 * on a year of data returns 12h and prints more ticks than MAX_TICKS rather
 * than silently promoting itself to days, because the user asked for hours
 * and a wrong unit is worse than a crowded axis.
 */
function stepFor(span: number, unit: TickUnit): number {
  const safeSpan = Math.max(span, 1)
  if (unit === 'auto') {
    for (const step of AUTO_STEPS_MS) {
      if (safeSpan / step <= MAX_TICKS) return step
    }
    return AUTO_STEPS_MS[AUTO_STEPS_MS.length - 1]!
  }
  const steps = UNIT_STEPS[unit]
  for (const step of steps) {
    if (safeSpan / step <= MAX_TICKS) return step
  }
  return steps[steps.length - 1]!
}

/** Which label format a step implies, when the user has not named a unit. */
function unitForStep(step: number): Exclude<TickUnit, 'auto'> {
  if (step >= MONTH_MS) return 'month'
  if (step >= DAY_MS) return 'day'
  return 'hour'
}

/**
 * Explicit tick positions and their labels for TIMELINE mode only, computed
 * over the VISIBLE (post-zoom) slice so zooming in genuinely buys finer time
 * detail rather than the same eight labels spread wider.
 *
 * X is ordinal, so a tick is a POSITION and its label has to be looked up —
 * hence the map. Recharts' `tickFormatter` receives the position alone and
 * can reach nothing else. Overlay needs none of this: its x value IS the row
 * number the axis prints, so it uses recharts' own tick spacing.
 *
 * Label formats, by unit:
 *   hour  — HH:MM, prefixed with the date only when the DAY changes, so the
 *           time (the detail a short fetch needs) is not crowded out
 *   day   — 14 Jun; no time, which would name the arbitrary minute of
 *           whichever row happened to land on the boundary
 *   month — Jun 2026
 */
function buildTimeTicks(
  visible: SeriesPoint[],
  labels: number[],
  unit: TickUnit,
): { ticks: number[]; labelAt: Map<number, string>; step: number } {
  const ticks: number[] = []
  const labelAt = new Map<number, string>()
  if (visible.length === 0 || labels.length === 0) {
    return { ticks, labelAt, step: 0 }
  }

  const first = labels[visible[0].t]!
  const last = labels[visible[visible.length - 1].t]!
  if (!isNum(first) || !isNum(last)) return { ticks, labelAt, step: 0 }

  const step = stepFor(last - first, unit)
  const format = unit === 'auto' ? unitForStep(step) : unit

  let lastBucket: number | null = null
  let lastDay: string | null = null

  for (const p of visible) {
    const v = labels[p.t]
    if (!isNum(v)) continue
    const bucket = Math.floor(v / step)
    if (lastBucket !== null && bucket === lastBucket) continue
    lastBucket = bucket

    const d = new Date(v)
    if (format === 'month') {
      labelAt.set(
        p.t,
        d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }),
      )
    } else if (format === 'day') {
      labelAt.set(
        p.t,
        d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
      )
    } else {
      const day = d.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
      })
      const time = d.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      })
      labelAt.set(p.t, day !== lastDay ? `${day} · ${time}` : time)
      lastDay = day
    }
    ticks.push(p.t)
  }
  return { ticks, labelAt, step }
}

/** Human name for the resolved step, for the chart subtitle — the picker
 * says "Hr" but the axis may have landed on 6h, and hiding that would leave
 * the reader counting gridlines to find out. */
function stepLabel(step: number): string {
  if (step <= 0) return ''
  if (step >= MONTH_MS) {
    const m = Math.round(step / MONTH_MS)
    return m === 1 ? '1 month' : `${m} months`
  }
  if (step >= DAY_MS) {
    const d = Math.round(step / DAY_MS)
    return d === 1 ? '1 day' : `${d} days`
  }
  const h = Math.round(step / HOUR_MS)
  return h === 1 ? '1 hour' : `${h} hours`
}

/**
 * Y bounds over BOTH sides' Good values for the selected tags. Both modes
 * put the two sides on one axis, so this is no longer the correctness
 * measure it was when they were separate charts — it now supplies the 5%
 * padding and handles the degenerate single-value case recharts' own 'auto'
 * renders badly.
 */
function sharedYDomain(
  a: SeriesPoint[],
  b: SeriesPoint[],
  tags: string[],
): [number, number] | undefined {
  let min = Infinity
  let max = -Infinity
  for (const series of [a, b]) {
    for (const point of series) {
      for (const tag of tags) {
        const v = point[tag]
        if (v === null || v === undefined) continue
        if (v < min) min = v
        if (v > max) max = v
      }
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined
  if (min === max) return [min - 1, max + 1]
  const pad = (max - min) * 0.05
  return [min - pad, max + pad]
}

function tagColor(index: number): string {
  return chartColorVar(((index % MAX_TAGS) + 1) as 1 | 2 | 3 | 4 | 5)
}

function CompareTooltip({
  active,
  payload,
  label,
  tags,
  axis,
}: {
  active?: boolean
  payload?: { dataKey?: string; value?: number; payload?: SeriesPoint }[]
  label?: number
  tags: string[]
  axis: CompareAxis
}) {
  if (!active || !payload || payload.length === 0 || label === undefined) {
    return null
  }
  const row = payload[0]?.payload
  const sideColoured = axis === 'overlay' && tags.length === 1

  return (
    <div className="min-w-52 rounded-lg border border-border bg-popover p-3 text-xs shadow-xl">
      {axis === 'time' ? (
        <p className="mb-2 border-b border-border pb-2 font-mono text-muted-foreground">
          {/* `label` is the ordinal position; the real date rides on the
              point as `__t`. Full precision here regardless of the tick
              granularity — the picker controls the AXIS, not what a hover is
              allowed to reveal. */}
          {isNum(row?.__t)
            ? new Date(row.__t as number).toLocaleString()
            : `Position ${label.toLocaleString()}`}
        </p>
      ) : (
        // The overlay axis carries no time at all, so the tooltip is the ONLY
        // place the two sides' real moments appear — one line each, never
        // merged into a single header that would imply they are the same
        // instant.
        <div className="mb-2 space-y-0.5 border-b border-border pb-2 font-mono text-[10px] text-muted-foreground">
          <p className="text-foreground">
            Row {label.toLocaleString()}
            {isNum(row?.__trainT) && isNum(row?.__valT) ? '' : ' (one side)'}
          </p>
          {isNum(row?.__trainT) && (
            <p>train · {new Date(row.__trainT as number).toLocaleString()}</p>
          )}
          {isNum(row?.__valT) && (
            <p>val · {new Date(row.__valT as number).toLocaleString()}</p>
          )}
        </div>
      )}
      <div className="space-y-1.5">
        {tags.flatMap((tag, i) =>
          (
            [
              [tag, 'train', sideColoured ? TRAIN_COLOR : tagColor(i)],
              [
                `${tag}${VAL_SUFFIX}`,
                'validation',
                sideColoured ? VAL_COLOR : tagColor(i),
              ],
            ] as const
          ).map(([key, side, color]) => {
            const entry = payload.find(p => p.dataKey === key)
            // In timeline mode each position belongs to exactly one side, so
            // a row for the other side would be a permanent em-dash. In
            // overlay mode both usually have a value and a null is a real
            // Bad reading worth showing — so only timeline suppresses nulls.
            if (entry?.value === undefined) return null
            if (axis === 'time' && entry.value === null) return null
            return (
              <div
                key={key}
                className="flex items-center justify-between gap-6"
              >
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  {tag}
                  <span className="text-[10px] uppercase tracking-wide opacity-60">
                    {side}
                  </span>
                </span>
                <span className="font-mono font-semibold text-foreground tabular-nums">
                  {entry.value === null
                    ? '—'
                    : entry.value.toLocaleString(undefined, {
                        maximumFractionDigits: 4,
                      })}
                </span>
              </div>
            )
          }),
        )}
      </div>
    </div>
  )
}

/** Same button-driven zoom as `RawTrendChart` (chart/raw-data-chart.tsx) —
 * an index WINDOW over `series`, not a Brush. The Y domain stays locked to
 * the FULL series regardless of zoom (passed in from the parent, computed
 * from both unzoomed sides): zooming narrows the visible X range only, and
 * letting Y re-autoscale on zoom would rescale the two sides against each
 * other mid-comparison. Timeline's X ticks, by contrast, ARE recomputed per
 * zoom window — finer time detail is the whole reason to zoom. */
const X_ZOOM_STEP = 1.6
const MIN_VISIBLE_POINTS = 8

function ChartBox({
  title,
  subtitle,
  loading,
  errorMessage,
  series,
  tags,
  yDomain,
  labels,
  boundaryIndex,
  axis,
  tickUnit,
}: {
  title: string
  subtitle: string
  loading: boolean
  errorMessage: string | null
  series: SeriesPoint[]
  tags: string[]
  yDomain: [number, number] | undefined
  labels: number[]
  boundaryIndex: number | null
  axis: CompareAxis
  tickUnit: TickUnit
}) {
  const [zoomWindow, setZoomWindow] = useState<[number, number] | null>(null)
  useEffect(() => {
    setZoomWindow(null)
  }, [series])

  const zoomBy = (factor: number) => {
    setZoomWindow(prev => {
      const len = series.length
      if (len === 0) return prev
      const [s, e] = prev ?? [0, len - 1]
      const span = e - s + 1
      const nextSpan = Math.max(
        Math.min(MIN_VISIBLE_POINTS, len),
        Math.min(len, Math.round(span / factor)),
      )
      const center = (s + e) / 2
      const ns = Math.max(
        0,
        Math.min(len - nextSpan, Math.round(center - nextSpan / 2)),
      )
      return ns === 0 && nextSpan === len ? null : [ns, ns + nextSpan - 1]
    })
  }
  const panBy = (fraction: number) => {
    setZoomWindow(prev => {
      if (!prev) return prev
      const len = series.length
      const [s, e] = prev
      const span = e - s + 1
      const ns = Math.max(
        0,
        Math.min(len - span, s + Math.round(span * fraction)),
      )
      return [ns, ns + span - 1]
    })
  }

  // Colour carries the SIDE only when a single tag is selected; otherwise it
  // has to carry the tag and the dash carries the side.
  const sideColoured = axis === 'overlay' && tags.length === 1

  const visibleSeries = useMemo(
    () =>
      zoomWindow ? series.slice(zoomWindow[0], zoomWindow[1] + 1) : series,
    [series, zoomWindow],
  )
  const isZoomed =
    zoomWindow !== null &&
    (zoomWindow[0] > 0 || zoomWindow[1] < series.length - 1)

  // Timeline only. Overlay's x value is already the row number the axis
  // prints, so it takes recharts' own tick spacing and a plain formatter.
  const { ticks, labelAt, step } = useMemo(
    () =>
      axis === 'time'
        ? buildTimeTicks(visibleSeries, labels, tickUnit)
        : { ticks: [], labelAt: new Map<number, string>(), step: 0 },
    [axis, visibleSeries, labels, tickUnit],
  )

  const showChart = !loading && !errorMessage && tags.length > 0

  return (
    <div className="space-y-1.5 rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-[11px] text-muted-foreground">
            {subtitle}
            {showChart && axis === 'time' && step > 0 && (
              <span className="text-muted-foreground/70">
                {' '}
                · ticks every {stepLabel(step)}
              </span>
            )}
          </p>
        </div>
        {showChart && (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Pan earlier"
              onClick={() => panBy(-0.5)}
              disabled={!zoomWindow || zoomWindow[0] <= 0}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Pan later"
              onClick={() => panBy(0.5)}
              disabled={!zoomWindow || zoomWindow[1] >= series.length - 1}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Zoom in"
              onClick={() => zoomBy(X_ZOOM_STEP)}
              disabled={visibleSeries.length <= MIN_VISIBLE_POINTS}
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Zoom out"
              onClick={() => zoomBy(1 / X_ZOOM_STEP)}
              disabled={!isZoomed}
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Reset zoom"
              onClick={() => setZoomWindow(null)}
              disabled={!isZoomed}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
            <span className="ml-1 font-mono text-[10px] tabular-nums text-muted-foreground">
              {visibleSeries.length}/{series.length}
            </span>
          </div>
        )}
      </div>
      {loading ? (
        <Skeleton className="h-56 w-full rounded-lg" />
      ) : errorMessage ? (
        <p className="flex h-56 items-center justify-center text-center text-xs text-muted-foreground">
          {errorMessage}
        </p>
      ) : tags.length === 0 ? (
        <p className="flex h-56 items-center justify-center text-center text-xs text-muted-foreground">
          Select at least one tag to plot.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={440}>
          <LineChart
            data={visibleSeries}
            margin={{
              top: 8,
              right: 18,
              left: 0,
              bottom: axis === 'overlay' ? 14 : 0,
            }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border)"
              vertical={false}
            />
            <XAxis
              dataKey="t"
              type="number"
              domain={['dataMin', 'dataMax']}
              // ORDINAL IN BOTH MODES, so `scale="time"` applies to neither —
              // using it in timeline would reopen the row-cap gap this
              // closes. Timeline supplies its ticks explicitly with
              // `interval={0}`, because recharts' own spacing would drop the
              // ones the granularity choice deliberately produced; overlay
              // passes no ticks and lets recharts space row numbers itself.
              scale="linear"
              ticks={axis === 'time' ? ticks : undefined}
              interval={axis === 'time' ? 0 : 'preserveStartEnd'}
              tickFormatter={t =>
                axis === 'time' ? (labelAt.get(t) ?? '') : t.toLocaleString()
              }
              tick={AXIS_TICK}
              stroke="var(--border)"
              minTickGap={axis === 'time' ? undefined : 40}
              label={
                axis === 'overlay'
                  ? {
                      value: "Row index from each side's start",
                      position: 'insideBottom',
                      offset: -2,
                      fill: 'var(--muted-foreground)',
                      fontSize: 10,
                    }
                  : undefined
              }
            />
            <YAxis
              domain={yDomain ?? ['auto', 'auto']}
              tick={AXIS_TICK}
              stroke="var(--border)"
              width={56}
              tickFormatter={v =>
                isNum(v)
                  ? v.toLocaleString(undefined, { maximumFractionDigits: 4 })
                  : ''
              }
            />
            <Tooltip content={<CompareTooltip tags={tags} axis={axis} />} />
            {/* At the sorted POSITION where the validation side starts, not a
                timestamp — X is ordinal. Overlay has no boundary at all. */}
            {axis === 'time' && boundaryIndex !== null && (
              <ReferenceLine
                x={boundaryIndex}
                stroke="var(--muted-foreground)"
                strokeDasharray="3 3"
                label={{
                  value: 'Validation starts',
                  position: 'insideTopRight',
                  fill: 'var(--muted-foreground)',
                  fontSize: 10,
                }}
              />
            )}
            {tags.map((tag, i) => (
              <Line
                key={tag}
                type="monotone"
                dataKey={tag}
                name={`${tag} · train`}
                stroke={sideColoured ? TRAIN_COLOR : tagColor(i)}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                // No `connectNulls` — a Bad-status gap must BREAK the line,
                // never bridge over it (recharts' default already does this;
                // stated explicitly because getting it backwards here is the
                // one mistake that silently fabricates data).
              />
            ))}
            {tags.map((tag, i) => (
              <Line
                key={`${tag}${VAL_SUFFIX}`}
                type="monotone"
                dataKey={`${tag}${VAL_SUFFIX}`}
                name={`${tag} · validation`}
                stroke={sideColoured ? VAL_COLOR : tagColor(i)}
                strokeWidth={2}
                // The dash is dropped only when colour already separates the
                // two sides — carrying both cues at once reads as four
                // categories rather than two.
                strokeDasharray={sideColoured ? undefined : '5 3'}
                strokeOpacity={sideColoured ? 0.85 : 1}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

/**
 * Per-side legend. Two legends only earn their space because each carries
 * ITS OWN numbers — the same tag/colour list twice would be noise.
 *
 * Computed from the UNMERGED series, so each side's stats describe that side
 * alone, and from the FULL series rather than the chart's zoom window, so a
 * mean does not silently move when the user zooms.
 *
 * The date span in the header is load-bearing in OVERLAY mode: the axis
 * there is a bare row number, so this is the only place each side's real
 * window is stated.
 *
 * `color` overrides the per-tag palette for single-tag overlay mode, where
 * the chart colours by side instead — the legend must index colour exactly
 * the way the lines do or it lies about which line is which.
 */
function SideLegend({
  title,
  series,
  tags,
  dashed,
  color,
}: {
  title: string
  series: SeriesPoint[]
  tags: string[]
  dashed: boolean
  color?: string
}) {
  const rows = useMemo(
    () =>
      tags.map((tag, i) => {
        let sum = 0
        let n = 0
        let min = Infinity
        let max = -Infinity
        for (const p of series) {
          const v = p[tag]
          if (v === null || v === undefined) continue
          sum += v
          n += 1
          if (v < min) min = v
          if (v > max) max = v
        }
        return {
          tag,
          color: color ?? tagColor(i),
          // n === 0 is a real state — every cell Bad on this side, or the tag
          // absent from it. An em-dash, never 0.00, same rule `goodValue`
          // follows and the analysis card states for its own count === 0 case.
          mean: n > 0 ? sum / n : null,
          min: n > 0 ? min : null,
          max: n > 0 ? max : null,
          coverage: series.length > 0 ? (n / series.length) * 100 : null,
        }
      }),
    [series, tags, color],
  )

  const span = useMemo(() => {
    if (series.length === 0) return null
    const first = series[0]?.t
    const last = series[series.length - 1]?.t
    if (!isNum(first) || !isNum(last)) return null
    const fmt = (t: number) =>
      new Date(t).toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    return `${fmt(first)} → ${fmt(last)}`
  }, [series])

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-2.5 py-1.5">
        <svg width="18" height="6" aria-hidden>
          <line
            x1="0"
            y1="3"
            x2="18"
            y2="3"
            stroke={color ?? 'var(--muted-foreground)'}
            strokeWidth="2"
            strokeDasharray={dashed ? '5 3' : undefined}
          />
        </svg>
        <p className="text-[11px] font-semibold text-foreground">{title}</p>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {series.length.toLocaleString()} rows
        </span>
      </div>
      {span && (
        <p className="border-b border-border px-2.5 py-1 font-mono text-[10px] text-muted-foreground">
          {span}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="px-2.5 py-3 text-center text-[11px] text-muted-foreground">
          No tag selected.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-7 pl-2.5 text-[10px]">Tag</TableHead>
              <TableHead className="h-7 text-right text-[10px]">Mean</TableHead>
              <TableHead className="h-7 text-right text-[10px]">Min</TableHead>
              <TableHead className="h-7 text-right text-[10px]">Max</TableHead>
              <TableHead className="h-7 pr-2.5 text-right text-[10px]">
                Good
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(r => (
              <TableRow key={r.tag}>
                <TableCell className="py-1 pl-2.5">
                  <span className="flex items-center gap-2">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: r.color }}
                    />
                    <span className="truncate font-mono text-[11px]">
                      {r.tag}
                    </span>
                  </span>
                </TableCell>
                <TableCell className="py-1 text-right font-mono text-[11px] tabular-nums">
                  {fmtNum(r.mean)}
                </TableCell>
                <TableCell className="py-1 text-right font-mono text-[11px] tabular-nums">
                  {fmtNum(r.min)}
                </TableCell>
                <TableCell className="py-1 text-right font-mono text-[11px] tabular-nums">
                  {fmtNum(r.max)}
                </TableCell>
                <TableCell className="py-1 pr-2.5 text-right font-mono text-[11px] tabular-nums">
                  {r.coverage === null ? '—' : `${r.coverage.toFixed(0)}%`}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

/** The Raw Table counterpart to `ChartBox` — same header/loading/error
 * contract so the two tabs read identically. Two separate tables rather than
 * one merged one: rows from the two sides are not comparable side by side
 * the way two lines on an axis are, and interleaving them would produce a
 * table where half of every row is blank. */
function TableBox({
  title,
  subtitle,
  loading,
  errorMessage,
  sample,
  tags,
}: {
  title: string
  subtitle: string
  loading: boolean
  errorMessage: string | null
  sample: Dataset | null
  tags: string[]
}) {
  return (
    <div className="space-y-1.5 rounded-lg border border-border p-3">
      <div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-[11px] text-muted-foreground">{subtitle}</p>
      </div>
      {loading ? (
        <Skeleton className="h-56 w-full rounded-lg" />
      ) : errorMessage ? (
        <p className="flex h-56 items-center justify-center text-center text-xs text-muted-foreground">
          {errorMessage}
        </p>
      ) : tags.length === 0 ? (
        <p className="flex h-56 items-center justify-center text-center text-xs text-muted-foreground">
          Select at least one tag to show.
        </p>
      ) : !sample ? (
        <p className="flex h-56 items-center justify-center text-center text-xs text-muted-foreground">
          No rows to show.
        </p>
      ) : (
        // `scalers={{}}` — NOT the wizard's scaler config. The table renders a
        // `WandSparkles minmax` badge per configured column, and every value
        // here has already been converted BACK to engineering units, so that
        // badge would claim the exact opposite of what is on screen. Same
        // reason there is no Raw/Scaled toggle: scaling here is a past fact
        // about the stored bytes, not a view option.
        <RawReadingsTable dataset={sample} scalers={{}} />
      )}
    </div>
  )
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  datasetId: string | null
  artifactId: string | null
  availableTags: string[]
  holdout: ArtifactHoldout | null
}

const TICK_UNIT_OPTIONS: { value: TickUnit; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'hour', label: 'Hr' },
  { value: 'day', label: 'D' },
  { value: 'month', label: 'M' },
]

export function DatasetCompareModal({
  open,
  onOpenChange,
  datasetId,
  artifactId,
  availableTags,
  holdout,
}: Props) {
  const [selected, setSelected] = useState<string[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [draft, setDraft] = useState<string[]>([])
  // Timeline is the default now that its row-cap gap is closed: it keeps the
  // real date order and the holdout boundary, which is what a comparison is
  // usually for. Overlay superimposes the two by row index, for shape.
  const [axis, setAxis] = useState<CompareAxis>('time')
  // Timeline-only. Kept across a mode switch rather than reset, so toggling
  // to Overlay and back does not silently discard the choice — overlay just
  // ignores it, its axis being a row number.
  const [tickUnit, setTickUnit] = useState<TickUnit>('auto')

  // DS-LAKE-025-T06. The scaler params the train artifact was written with —
  // gated on `open` so closing the sheet does not leave a fetch in flight.
  const {
    featureSpec,
    loading: specLoading,
    missing: specMissing,
    error: specError,
  } = useArtifactFeatureSpec(open ? datasetId : null, open ? artifactId : null)
  const scalingParams = featureSpec?.scalingParams ?? null

  // A tag is plottable only if its train values can be stated in engineering
  // units. Excluding the rest is the point: an un-invertible tag drawn beside
  // inverted ones on the shared axis is exactly what makes two unit spaces
  // look like a process change.
  const plottableTags = useMemo(() => {
    if (!scalingParams) return []
    return availableTags.filter(t => isInvertible(scalingParams[t]))
  }, [availableTags, scalingParams])

  const excludedCount = availableTags.length - plottableTags.length

  // Stable content key, not the array reference — the same discipline
  // `useArtifactRows`'s `boundedTagsKey` already uses. Depending on
  // `plottableTags` itself would re-run on every render and fight the user's
  // own selection.
  const plottableTagsKey = plottableTags.join(',')

  // Default to the first PLOTTABLE tag once the spec resolves — not on mount,
  // and not from `availableTags`, which includes tags this view cannot state
  // honestly. Also drops any selection that is no longer plottable after a
  // dataset switch, rather than carrying it into a chart that cannot show it.
  useEffect(() => {
    if (!open) {
      setSelected([])
      return
    }
    const plottable = plottableTagsKey ? plottableTagsKey.split(',') : []
    setSelected(prev => {
      const kept = prev.filter(t => plottable.includes(t))
      return kept.length > 0 ? kept : plottable.slice(0, 1)
    })
  }, [open, plottableTagsKey])

  const trainArtifactId = selected.length > 0 ? artifactId : null

  const {
    sample: trainSample,
    loading: trainLoading,
    error: trainError,
  } = useArtifactRows(datasetId, trainArtifactId, selected)

  const {
    sample: validationSample,
    loading: validationLoading,
    missing: validationMissing,
    error: validationError,
  } = useArtifactValidationRows(datasetId, artifactId, selected)

  // Train inverted to engineering units; validation already raw on disk.
  const trainSeries = useMemo(
    () => toSeries(trainSample, selected, scalingParams),
    [trainSample, selected, scalingParams],
  )
  const validationSeries = useMemo(
    () => toSeries(validationSample, selected, null),
    [validationSample, selected],
  )

  const trainTable = useMemo(
    () => inverseDataset(trainSample, scalingParams),
    [trainSample, scalingParams],
  )
  const validationTable = useMemo(
    () => inverseDataset(validationSample, null),
    [validationSample],
  )

  const {
    points: merged,
    labels,
    boundaryIndex,
  } = useMemo(
    () =>
      axis === 'time'
        ? mergeByTime(trainSeries, validationSeries, selected)
        : mergeByIndex(trainSeries, validationSeries, selected),
    [axis, trainSeries, validationSeries, selected],
  )

  const yDomain = useMemo(
    () => sharedYDomain(trainSeries, validationSeries, selected),
    [trainSeries, validationSeries, selected],
  )

  const sideColoured = axis === 'overlay' && selected.length === 1

  const handlePickerOpenChange = (next: boolean) => {
    if (next) setDraft(selected)
    setPickerOpen(next)
  }

  const toggleDraft = (tag: string) =>
    setDraft(prev => {
      if (prev.includes(tag)) return prev.filter(t => t !== tag)
      if (prev.length >= MAX_TAGS) return prev
      return [...prev, tag]
    })

  // Ordered by `plottableTags`, not by click order — the committed list is
  // always in the dataset's own tag order, the same normalisation
  // `TagsSelector`'s `toOverride` applies.
  const commitDraft = () => {
    setSelected(plottableTags.filter(t => draft.includes(t)))
    setPickerOpen(false)
  }

  const validationErrorMessage = validationMissing
    ? 'The validation holdout is no longer retained.'
    : validationError
      ? `Could not load validation rows — ${validationError}`
      : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto scrollbar-none sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Comparison data</DialogTitle>
          <DialogDescription>
            {holdout
              ? `Validation window ${new Date(holdout.holdoutFrom).toLocaleDateString()}${
                  holdout.holdoutTo
                    ? ` – ${new Date(holdout.holdoutTo).toLocaleDateString()}`
                    : ''
                } · ${holdout.rowCount.toLocaleString()} validation rows.`
              : 'Both sides on one shared value axis, in engineering units.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Dialog open={pickerOpen} onOpenChange={handlePickerOpenChange}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                size="sm"
                className="h-8 justify-between"
                disabled={plottableTags.length === 0}
              >
                {selected.length === 0
                  ? 'Select tags'
                  : `${selected.length} tag${selected.length > 1 ? 's' : ''} selected`}
                <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Select Tags</DialogTitle>
                <DialogDescription>
                  Choose which tags to plot. Both sides show the same tags, up
                  to {MAX_TAGS}.
                </DialogDescription>
              </DialogHeader>

              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {draft.length} of {MAX_TAGS} selected
                </span>
                {/* No "Select all" — MAX_TAGS caps this selector, so selecting
                    all is only ever meaningful when the dataset has
                    <= MAX_TAGS plottable tags. Same reason TagsSelector hides
                    it whenever `max` is set. */}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => setDraft([])}
                  disabled={draft.length === 0}
                >
                  Clear
                </Button>
              </div>

              <Command className="gap-2 rounded-lg ring-1 ring-foreground/10">
                <CommandInput placeholder="Search signals…" />
                <CommandList className="max-h-60 overflow-y-auto px-1.5 py-1.5">
                  <CommandEmpty>
                    {availableTags.length === 0
                      ? 'No tags available.'
                      : plottableTags.length === 0
                        ? 'No tag on this dataset can be shown in engineering units.'
                        : 'No signals found.'}
                  </CommandEmpty>
                  {plottableTags.map(tag => {
                    const meta = resolveTagMeta(tag)
                    const isSelected = draft.includes(tag)
                    const atCap = !isSelected && draft.length >= MAX_TAGS
                    // Colour follows SELECTION ORDER, not tag identity —
                    // `tagColor(i)` is what the chart's own <Line> uses, so
                    // the dot here must index the same way or it lies about
                    // which line is which. An unpicked tag has no order yet,
                    // hence no dot.
                    const draftIndex = draft.indexOf(tag)
                    return (
                      <CommandItem
                        key={tag}
                        value={`${tag} ${meta.label}`}
                        disabled={atCap}
                        onSelect={() => toggleDraft(tag)}
                        className={cn(
                          'mb-2 last:mb-0',
                          'flex items-center gap-3',
                          'gap-5 rounded-lg border border-transparent px-3 py-2.5 text-sm text-foreground',
                          'transition-colors',
                          isSelected
                            ? 'border-primary/20 bg-primary/10'
                            : 'hover:bg-muted',
                          atCap && 'opacity-40',
                        )}
                      >
                        <Check
                          className={cn(
                            'h-4 w-4 shrink-0 text-primary transition-opacity',
                            isSelected ? 'opacity-100' : 'opacity-0',
                          )}
                        />
                        <span
                          className={cn(
                            'h-2.5 w-2.5 shrink-0 rounded-full',
                            !isSelected && 'opacity-0',
                          )}
                          style={
                            isSelected
                              ? { backgroundColor: tagColor(draftIndex) }
                              : undefined
                          }
                        />
                        <div className="grid flex-1 grid-cols-2 items-center gap-4">
                          <span className="truncate font-medium">{tag}</span>
                          <span className="truncate text-left text-xs text-muted-foreground">
                            {meta.label}
                            {meta.unit ? ` · ${meta.unit}` : ''}
                          </span>
                        </div>
                      </CommandItem>
                    )
                  })}
                </CommandList>
              </Command>

              <DialogFooter>
                <Button variant="outline" onClick={() => setPickerOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={commitDraft} disabled={draft.length === 0}>
                  Apply ({draft.length})
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {selected.length >= MAX_TAGS && (
            <span className="text-[11px] text-muted-foreground">
              Max {MAX_TAGS} tags at once.
            </span>
          )}
          {excludedCount > 0 && plottableTags.length > 0 && (
            <span className="text-[11px] text-muted-foreground">
              {excludedCount} tag{excludedCount > 1 ? 's' : ''} hidden — no
              recorded scaler fit, so they cannot be shown in engineering units.
            </span>
          )}

          <div className="ml-auto flex items-center gap-2">
            {/* TIMELINE ONLY, and rendered only there rather than disabled:
                overlay's axis is a row number, so hour/day/month names
                nothing it could switch between, and a greyed control implies
                a setting that would apply if only something else changed. */}
            {axis === 'time' && (
              <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
                <span className="px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Ticks
                </span>
                {TICK_UNIT_OPTIONS.map(option => (
                  <Button
                    key={option.value}
                    size="sm"
                    variant={tickUnit === option.value ? 'secondary' : 'ghost'}
                    className="h-6 px-2 text-[11px]"
                    onClick={() => setTickUnit(option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            )}

            <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
              <Button
                size="sm"
                variant={axis === 'time' ? 'secondary' : 'ghost'}
                className="h-6 px-2 text-[11px]"
                onClick={() => setAxis('time')}
              >
                Timeline
              </Button>
              <Button
                size="sm"
                variant={axis === 'overlay' ? 'secondary' : 'ghost'}
                className="h-6 px-2 text-[11px]"
                onClick={() => setAxis('overlay')}
              >
                Overlay
              </Button>
            </div>
          </div>
        </div>

        {/* DS-LAKE-025-T06. Without the scaler fit there is no way to state
            the train side in engineering units, and plotting its scaled values
            against the raw holdout is the defect this whole path exists to
            fix — so say so instead of drawing it. */}
        {specMissing || specError ? (
          <p className="rounded-lg border border-border p-4 text-center text-xs text-muted-foreground">
            {specMissing
              ? 'This dataset records no scaler fit, so its stored values cannot be converted to engineering units. A comparison here would put two different unit scales on one axis, so it is not shown.'
              : `Could not load the feature specification — ${specError}`}
          </p>
        ) : (
          <Tabs defaultValue="line" className="flex w-full flex-col">
            <TabsList className="mb-3 inline-flex flex-wrap gap-4 border-b border-border">
              <TabsTrigger value="line" className="cursor-pointer gap-2">
                <LineChartIcon className="h-3.5 w-3.5" /> Line Chart
              </TabsTrigger>
              <TabsTrigger value="raw-table" className="cursor-pointer gap-2">
                <Table2 className="h-3.5 w-3.5" /> Raw Table
              </TabsTrigger>
            </TabsList>

            <TabsContent value="line" className="mt-0 space-y-3">
              <ChartBox
                title="Train vs. validation"
                subtitle={
                  axis === 'time'
                    ? 'Engineering units · adjacent in date order'
                    : 'Engineering units · superimposed by row index'
                }
                // Only the TRAIN side gates the chart: a missing holdout still
                // leaves a real train line worth drawing, so its error goes to
                // that side's legend rather than replacing the whole chart.
                loading={trainLoading || validationLoading || specLoading}
                errorMessage={
                  trainError ? `Could not load rows — ${trainError}` : null
                }
                series={merged}
                tags={selected}
                yDomain={yDomain}
                labels={labels}
                boundaryIndex={boundaryIndex}
                axis={axis}
                tickUnit={tickUnit}
              />

              {axis === 'overlay' && selected.length > 1 && (
                <p className="text-[11px] text-muted-foreground">
                  Colour separates the two sides only with one tag selected.
                  With {selected.length}, colour is the tag and the dashed line
                  is the validation side.
                </p>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <SideLegend
                  title="Dataset (train)"
                  series={trainSeries}
                  tags={selected}
                  dashed={false}
                  color={sideColoured ? TRAIN_COLOR : undefined}
                />
                {validationErrorMessage ? (
                  <p className="flex items-center justify-center rounded-md border border-border p-4 text-center text-xs text-muted-foreground">
                    {validationErrorMessage}
                  </p>
                ) : (
                  <SideLegend
                    title="Validation"
                    series={validationSeries}
                    tags={selected}
                    dashed={!sideColoured}
                    color={sideColoured ? VAL_COLOR : undefined}
                  />
                )}
              </div>
            </TabsContent>

            <TabsContent value="raw-table" className="mt-0 space-y-3">
              <TableBox
                title="Dataset (train)"
                subtitle={
                  trainTable
                    ? `${trainTable.rows.length.toLocaleString()} rows shown (chronological, capped at ${COMPARE_ROWS}) · engineering units`
                    : 'Training artifact · engineering units'
                }
                loading={trainLoading || specLoading}
                errorMessage={
                  trainError ? `Could not load rows — ${trainError}` : null
                }
                sample={trainTable}
                tags={selected}
              />
              <TableBox
                title="Validation"
                subtitle={
                  validationTable
                    ? `${validationTable.rows.length.toLocaleString()} rows shown (chronological, capped at ${COMPARE_ROWS}) · engineering units`
                    : 'Validation holdout · engineering units'
                }
                loading={validationLoading}
                errorMessage={validationErrorMessage}
                sample={validationTable}
                tags={selected}
              />
            </TabsContent>

            <p className="mt-3 text-[11px] text-muted-foreground/70">
              {axis === 'time' ? (
                <>
                  The two sides sit adjacent in true date order, with the marked
                  line where the holdout begins. The Ticks control sets the
                  label granularity — Hr keeps hour-level detail on a short
                  fetch, and on a long one it settles at the coarsest hour step
                  rather than switching to days. Positions are evenly spaced, so{' '}
                  <strong className="font-semibold">
                    distance along the axis is order, not elapsed time
                  </strong>{' '}
                  — each side shows only its first {COMPARE_ROWS} rows, and the
                  unloaded stretch between them is closed rather than drawn.
                </>
              ) : (
                <>
                  Both sides are drawn from their own first row, so the X axis
                  is a row index —{' '}
                  <strong className="font-semibold">not a clock</strong>. One
                  position holds a different timestamp on each side, and the
                  holdout boundary has no position here. Each side&apos;s real
                  window is named under its legend, and the tooltip gives both
                  timestamps. Switch to Timeline for dates.
                </>
              )}{' '}
              Gaps inside a line are Bad-status readings, not zero. The saved
              dataset is stored model-ready (scaled); its values are converted
              back to engineering units from the recorded scaler fit, accurate
              to about 0.1% of each tag&apos;s range. The validation holdout is
              stored raw and is shown as-is.
            </p>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}
