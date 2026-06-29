'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useAtomValue } from 'jotai'
import {
  CalendarRange,
  Download,
  LineChart,
  Loader2,
  RotateCw,
  Table2,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useModelDatasetFetch } from '@/hooks/model/use-model-dataset-fetch'
import {
  mpRawDatasetAtom,
  mpSelectedTagsAtom,
  mpTimeRangeAtom,
  PERIOD_TO_RANGE,
  type FetchPeriod,
} from '@/store/model-pipeline'
import { toChartRows } from '@/lib/preprocessing'
import { SegmentedToggle } from '@/app/(default)/data-visualize/components/segmented-toggle'
import { SensorTrendChart } from '@/app/(default)/data-visualize/components/sensor-trend-chart'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'
import { RawReadingsTable } from './raw-readings-table'

const PERIOD_LABELS: Record<FetchPeriod, string> = {
  '1min': 'Every 1 min',
  '5min': 'Every 5 min',
  '10min': 'Every 10 min',
  '1h': 'Every 1 hr',
  '1d': 'Every 1 day',
}

const formatDateTimeLocal = (date: Date) => {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

type ViewMode = 'chart' | 'table'

interface Props {
  nav: UsePipelineNavResult
}

export function Phase3RawData({ nav }: Props) {
  const selectedTags = useAtomValue(mpSelectedTagsAtom)
  const range = useAtomValue(mpTimeRangeAtom)
  const raw = useAtomValue(mpRawDatasetAtom)
  const fetch = useModelDatasetFetch()

  const [useCustom, setUseCustom] = useState(false)
  const [view, setView] = useState<ViewMode>('chart')
  const autoStarted = useRef(false)

  const now = new Date()
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
  const [customFrom, setCustomFrom] = useState(() =>
    formatDateTimeLocal(oneHourAgo),
  )
  const [customTo, setCustomTo] = useState(() => formatDateTimeLocal(now))

  const isFetching = fetch.status === 'fetching'
  const isDone = fetch.status === 'done'

  // Auto-fetch on first entry so Phase 3 lands directly on the raw view.
  useEffect(() => {
    if (autoStarted.current) return
    if (fetch.status === 'idle' && selectedTags.length > 0) {
      autoStarted.current = true
      fetch.start(selectedTags, range)
    }
  }, [fetch, selectedTags, range])

  const chartRows = useMemo(() => toChartRows(raw), [raw])
  const summary = useMemo(() => {
    const badRows = raw.rows.filter(r =>
      raw.tags.some(t => r.cells[t]?.status === 'Bad'),
    ).length
    let questionableCells = 0
    for (const r of raw.rows) {
      for (const t of raw.tags) {
        if (r.cells[t]?.status === 'Questionable') questionableCells++
      }
    }
    return `${raw.rows.length} rows · ${badRows} bad · ${questionableCells} questionable cells`
  }, [raw])

  const handlePresetChange = (r: FetchPeriod) => {
    setUseCustom(false)
    nav.setTimeRange(r)
  }
  const handleCustomToggle = () => {
    if (!useCustom) {
      setUseCustom(true)
      nav.setCustomRange(customFrom, customTo)
    } else {
      setUseCustom(false)
      nav.clearCustomRange()
    }
  }
  const handleCustomFromChange = (v: string) => {
    setCustomFrom(v)
    if (useCustom) nav.setCustomRange(v, customTo)
  }
  const handleCustomToChange = (v: string) => {
    setCustomTo(v)
    if (useCustom) nav.setCustomRange(customFrom, v)
  }

  return (
    <div className="space-y-5">
      {/* Fetch period */}
      <div
        className={cn(
          'space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10',
          isFetching && 'pointer-events-none opacity-50',
        )}
      >
        <div className="flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">Fetch period</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(['1min', '5min', '10min', '1h', '1d'] as const).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => handlePresetChange(p)}
              disabled={isFetching}
              className={cn(
                'h-8 px-3 rounded-md text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                range === p && !useCustom
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-transparent ring-1 ring-border text-foreground hover:bg-muted',
                (useCustom || isFetching) && 'opacity-50 hover:bg-transparent',
              )}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
          <div className="mx-1 h-4 w-px bg-border" />
          <button
            type="button"
            onClick={handleCustomToggle}
            disabled={isFetching}
            className={cn(
              'h-8 px-3 rounded-md text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              useCustom
                ? 'bg-primary text-primary-foreground'
                : 'bg-transparent ring-1 ring-border text-foreground hover:bg-muted',
            )}
          >
            Custom
          </button>
        </div>

        {useCustom && (
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="grid gap-1.5">
              <Label htmlFor="mp-fetch-from" className="text-xs">
                From
              </Label>
              <Input
                id="mp-fetch-from"
                type="datetime-local"
                value={customFrom}
                max={customTo}
                onChange={e => handleCustomFromChange(e.target.value)}
                className="h-8 font-mono text-xs"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mp-fetch-to" className="text-xs">
                To
              </Label>
              <Input
                id="mp-fetch-to"
                type="datetime-local"
                value={customTo}
                min={customFrom}
                max={formatDateTimeLocal(now)}
                onChange={e => handleCustomToChange(e.target.value)}
                className="h-8 font-mono text-xs"
              />
            </div>
          </div>
        )}

        <Button
          className="h-9 w-full"
          variant={isDone ? 'outline' : 'default'}
          onClick={() => fetch.retry(selectedTags, range)}
          disabled={isFetching || selectedTags.length === 0}
        >
          {isFetching ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Fetching…
            </>
          ) : (
            <>
              {isDone ? (
                <RotateCw className="mr-2 h-4 w-4" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              {isDone ? 'Re-fetch' : 'Fetch Data'}
            </>
          )}
        </Button>
      </div>

      {/* Body */}
      {fetch.status === 'error' ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t fetch sensor data</AlertTitle>
          <AlertDescription>{fetch.error}</AlertDescription>
          <Button
            size="sm"
            variant="outline"
            className="mt-2 w-fit"
            onClick={() => fetch.retry(selectedTags, range)}
          >
            <RotateCw className="mr-2 h-3.5 w-3.5" />
            Retry
          </Button>
        </Alert>
      ) : isFetching ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Fetching {selectedTags.length} tag
            {selectedTags.length === 1 ? '' : 's'}…
          </p>
          <Progress value={fetch.progress} />
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </div>
      ) : isDone ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">{summary}</p>
            <SegmentedToggle
              ariaLabel="View mode"
              value={view}
              onChange={setView}
              options={[
                {
                  value: 'chart',
                  label: 'Chart',
                  icon: <LineChart className="h-3.5 w-3.5" />,
                },
                {
                  value: 'table',
                  label: 'Table',
                  icon: <Table2 className="h-3.5 w-3.5" />,
                },
              ]}
            />
          </div>
          {view === 'chart' ? (
            <SensorTrendChart
              rows={chartRows}
              tags={raw.tags}
              range={PERIOD_TO_RANGE[range]}
            />
          ) : (
            <RawReadingsTable dataset={raw} />
          )}
        </div>
      ) : null}
    </div>
  )
}
