'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { chartColorVar } from '@/lib/mock-readings'
import type { Cell, Dataset } from '@/lib/preprocessing'
import { useArtifactRows } from '@/hooks/dataset/artifact/use-artifact-rows'
import {
  useArtifactValidationRows,
  COMPARE_ROWS,
} from '@/hooks/dataset/artifact/use-artifact-validation-rows'
import type { ArtifactHoldout } from '@/services/dataset-version'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'

/** Caps selection at the design system's fixed categorical chart palette
 * (`--chart-1` … `--chart-5`, docs/DESIGN_SYSTEM.md) — a 6th tag would need
 * a generated hue, which the palette is deliberately fixed-order to avoid. */
const MAX_TAGS = 5

const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 11 }

type SeriesPoint = { t: number } & Record<string, number | null>

/** Non-Good cells become `null`, not the stored numeric value — a Bad
 * reading is 0.0 in the parquet (same rule this file's own Export section
 * documents: "a Bad reading exports as a blank cell"), and plotting that 0
 * would read as a real dip in a tag that normally runs far from zero. */
function goodValue(cell: Cell | undefined): number | null {
  return cell && cell.status === 'Good' ? cell.value : null
}

function toSeries(sample: Dataset | null, tags: string[]): SeriesPoint[] {
  if (!sample) return []
  return sample.rows.map(row => {
    const point = { t: new Date(row.timestamp).getTime() } as SeriesPoint
    for (const tag of tags) point[tag] = goodValue(row.cells[tag])
    return point
  })
}

const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v)

/** Shared, LOCKED across both boxes — computed from the union of both
 * sides' Good values for the selected tags. Independent auto-scaling would
 * make the two panels visually incomparable: a tag with a narrower range on
 * one side would look like it swings less, when it may just have less
 * range to swing in. */
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
}: {
  active?: boolean
  payload?: { dataKey?: string; value?: number }[]
  label?: number
  tags: string[]
}) {
  if (!active || !payload || payload.length === 0 || label === undefined) {
    return null
  }
  return (
    <div className="min-w-40 rounded-lg border border-border bg-popover p-3 text-xs shadow-xl">
      <p className="mb-2 border-b border-border pb-2 font-mono text-muted-foreground">
        {new Date(label).toLocaleString()}
      </p>
      <div className="space-y-1.5">
        {tags.map((tag, i) => {
          const entry = payload.find(p => p.dataKey === tag)
          return (
            <div key={tag} className="flex items-center justify-between gap-6">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: tagColor(i) }}
                />
                {tag}
              </span>
              <span className="font-mono font-semibold text-foreground tabular-nums">
                {entry?.value === undefined || entry.value === null
                  ? '—'
                  : entry.value.toLocaleString(undefined, {
                      maximumFractionDigits: 2,
                    })}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Same button-driven zoom as `RawTrendChart` (chart/raw-data-chart.tsx) —
 * an index WINDOW over `series`, not a Brush. Y-domain stays locked to the
 * FULL series regardless of zoom (passed in from the parent, computed from
 * both unzoomed sides) — zooming narrows the visible X range only; letting
 * Y re-autoscale on zoom would break the train/validation comparability the
 * lock exists for. */
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
}: {
  title: string
  subtitle: string
  loading: boolean
  errorMessage: string | null
  series: SeriesPoint[]
  tags: string[]
  yDomain: [number, number] | undefined
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

  const visibleSeries = useMemo(
    () =>
      zoomWindow ? series.slice(zoomWindow[0], zoomWindow[1] + 1) : series,
    [series, zoomWindow],
  )
  const isZoomed =
    zoomWindow !== null &&
    (zoomWindow[0] > 0 || zoomWindow[1] < series.length - 1)

  const showChart = !loading && !errorMessage && tags.length > 0

  return (
    <div className="space-y-1.5 rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-[11px] text-muted-foreground">{subtitle}</p>
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
        <ResponsiveContainer width="100%" height={320}>
          <LineChart
            data={visibleSeries}
            margin={{ top: 8, right: 18, left: 0, bottom: 0 }}
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
              scale="time"
              tickFormatter={t => new Date(t).toLocaleDateString()}
              tick={AXIS_TICK}
              stroke="var(--border)"
              minTickGap={40}
            />
            <YAxis
              domain={yDomain ?? ['auto', 'auto']}
              tick={AXIS_TICK}
              stroke="var(--border)"
              width={48}
              tickFormatter={v =>
                isNum(v)
                  ? v.toLocaleString(undefined, { maximumFractionDigits: 2 })
                  : ''
              }
            />
            <Tooltip content={<CompareTooltip tags={tags} />} />
            {tags.map((tag, i) => (
              <Line
                key={tag}
                type="monotone"
                dataKey={tag}
                stroke={tagColor(i)}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                // No `connectNulls` — a Bad-status gap must BREAK the line,
                // never bridge over it (recharts' default already does this;
                // stated explicitly because getting it backwards here is the
                // one mistake that silently fabricates data).
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
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

  // Default to the first available tag on open, not on mount — the modal
  // stays mounted across dataset switches in some callers, and a stale
  // selection from a PREVIOUS dataset must not silently carry over.
  useEffect(() => {
    if (open)
      setSelected(prev => (prev.length > 0 ? prev : availableTags.slice(0, 1)))
    else setSelected([])
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run on open transitions
  }, [open])

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

  const trainSeries = useMemo(
    () => toSeries(trainSample, selected),
    [trainSample, selected],
  )
  const validationSeries = useMemo(
    () => toSeries(validationSample, selected),
    [validationSample, selected],
  )
  const yDomain = useMemo(
    () => sharedYDomain(trainSeries, validationSeries, selected),
    [trainSeries, validationSeries, selected],
  )

  const toggleTag = (tag: string) => {
    setSelected(prev => {
      if (prev.includes(tag)) return prev.filter(t => t !== tag)
      if (prev.length >= MAX_TAGS) return prev
      return [...prev, tag]
    })
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
          <DialogTitle>Compare train vs. validation</DialogTitle>
          <DialogDescription>
            {holdout
              ? `Validation window ${new Date(holdout.holdoutFrom).toLocaleDateString()}${
                  holdout.holdoutTo
                    ? ` – ${new Date(holdout.holdoutTo).toLocaleDateString()}`
                    : ''
                } · ${holdout.rowCount.toLocaleString()} validation rows.`
              : 'Same tags plotted on both sides, on a shared Y-axis scale.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                size="sm"
                className="h-8 justify-between"
              >
                {selected.length === 0
                  ? 'Select tags'
                  : `${selected.length} tag${selected.length > 1 ? 's' : ''} selected`}
                <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-0" align="start">
              <Command>
                <CommandInput placeholder="Search tags…" />
                <CommandList>
                  <CommandEmpty>
                    {availableTags.length === 0
                      ? 'No tags available.'
                      : 'No tags found.'}
                  </CommandEmpty>
                  <CommandGroup>
                    {availableTags.map(tag => {
                      const isSelected = selected.includes(tag)
                      const atCap = !isSelected && selected.length >= MAX_TAGS
                      return (
                        <CommandItem
                          key={tag}
                          value={tag}
                          disabled={atCap}
                          onSelect={() => toggleTag(tag)}
                          className={cn(
                            'rounded-md',
                            isSelected
                              ? 'border border-primary/20'
                              : 'border border-transparent',
                            atCap && 'opacity-40',
                          )}
                        >
                          <Check
                            className={cn(
                              'text-primary transition-opacity',
                              isSelected ? 'opacity-100' : 'opacity-0',
                            )}
                          />
                          <span className="truncate font-medium">{tag}</span>
                        </CommandItem>
                      )
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          {selected.map((tag, i) => (
            <Badge key={tag} variant="secondary" className="gap-1.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: tagColor(i) }}
              />
              {tag}
            </Badge>
          ))}
          {selected.length >= MAX_TAGS && (
            <span className="text-[11px] text-muted-foreground">
              Max {MAX_TAGS} tags at once.
            </span>
          )}
        </div>

        <div className="space-y-3">
          <ChartBox
            title="Dataset (train)"
            subtitle={
              trainSample
                ? `${trainSample.rows.length.toLocaleString()} rows shown (chronological, capped at ${COMPARE_ROWS})`
                : 'Training artifact'
            }
            loading={trainLoading}
            errorMessage={
              trainError ? `Could not load rows — ${trainError}` : null
            }
            series={trainSeries}
            tags={selected}
            yDomain={yDomain}
          />
          <ChartBox
            title="Validation"
            subtitle={
              validationSample
                ? `${validationSample.rows.length.toLocaleString()} rows shown (chronological, capped at ${COMPARE_ROWS})`
                : 'Validation holdout'
            }
            loading={validationLoading}
            errorMessage={validationErrorMessage}
            series={validationSeries}
            tags={selected}
            yDomain={yDomain}
          />
        </div>

        <p className="text-[11px] text-muted-foreground/70">
          Each box shows the first {COMPARE_ROWS} rows of its own artifact — a
          chronological prefix, not decimated or evenly sampled across the full
          time range. Gaps in a line are Bad-status readings, not zero. The
          Y-axis scale is shared and locked across both boxes so the two are
          visually comparable.
        </p>
      </DialogContent>
    </Dialog>
  )
}
