'use client'

import { useAtom, useAtomValue } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import {
  CalendarRange,
  CircleDot,
  ClipboardClock,
  Download,
  Loader2,
  RotateCw,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { DateTimePicker, toDateTimeLocal } from '@/components/ui/Datetime'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useDatasetStudioFetch } from '@/hooks/dataset/use-dataset-studio-fetch'
import {
  dwCustomIntervalAtom,
  dwRawDatasetAtom,
  dwSelectedSourcesAtom,
  dwSelectedTagsAtom,
  dwSourceFetchConfigsAtom,
} from '@/store/dataset-studio'
import type { CustomInterval, FetchPeriod } from '@/store/model-pipeline'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RawReadingsTable } from './raw-readings-table'
import {
  SourceFetchConfigCard,
  configFromSource,
  defaultConfigForKind,
} from './source-configs/source-fetch-config-card'
import { UseDatasetPipelineNavResult } from '@/hooks/dataset/use-dataset-pipeline-nav'

const PERIOD_LABELS: Record<FetchPeriod, string> = {
  '1min': 'Every 1 min',
  '5min': 'Every 5 min',
  '10min': 'Every 10 min',
  '1h': 'Every 1 hr',
  '1d': 'Every 1 day',
}

interface Props {
  nav: UseDatasetPipelineNavResult
}

export function Step2RawData({ nav }: Props) {
  // The tags the user checked in Step 1 (dwSelectedTagsAtom) are exactly what
  // we fetch — no separate fetch-subset sentinel.
  const fetchTags = useAtomValue(dwSelectedTagsAtom)

  const range = nav.timeRange
  const raw = useAtomValue(dwRawDatasetAtom)
  const fetch = useDatasetStudioFetch()
  const [customInterval, setCustomInterval] = useAtom(dwCustomIntervalAtom)

  const selectedSources = useAtomValue(dwSelectedSourcesAtom)

  const [sourceConfigs, setSourceConfigs] = useAtom(dwSourceFetchConfigsAtom)

  useEffect(() => {
    if (selectedSources.length === 0) return
    setSourceConfigs(prev => {
      const next = { ...prev }
      let changed = false
      for (const source of selectedSources) {
        if (!next[source.id]) {
          next[source.id] = configFromSource(source)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [selectedSources, setSourceConfigs])

  const isCustomInterval = customInterval !== null
  const [customValue, setCustomValue] = useState(customInterval?.value ?? 1)
  const [customUnit, setCustomUnit] = useState<CustomInterval['unit']>(
    customInterval?.unit ?? 'min',
  )

  const customInitialized = useRef(false)
  // Set true right before a user-triggered fetch so the completion effect
  // auto-advances to step 5 — but only for that fetch, not when returning here.
  const advanceOnDone = useRef(false)

  const now = new Date()
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
  const [customFrom, setCustomFrom] = useState(() =>
    toDateTimeLocal(oneHourAgo),
  )
  const [customTo, setCustomTo] = useState(() => toDateTimeLocal(now))

  const isFetching = fetch.status === 'fetching'
  const isDone = fetch.status === 'done'

  useEffect(() => {
    if (customInitialized.current) return
    customInitialized.current = true
    if (nav.customDateRange === null) {
      nav.setCustomRange(customFrom, customTo)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handlePresetChange = (r: FetchPeriod) => {
    setCustomInterval(null)
    nav.setTimeRange(r)
  }

  const handleCustomFromChange = (v: string) => {
    setCustomFrom(v)
    nav.setCustomRange(v, customTo)
  }

  const handleCustomToChange = (v: string) => {
    setCustomTo(v)
    nav.setCustomRange(customFrom, v)
  }

  const handleFetch = () => {
    advanceOnDone.current = true
    fetch.retry(fetchTags, range)
  }

  const { next } = nav
  useEffect(() => {
    if (fetch.status === 'done' && advanceOnDone.current) {
      advanceOnDone.current = false
      next()
    }
  }, [fetch.status, next])

  return (
    <div className="space-y-5">
      {/* ── Per-source fetch configuration ─────────────────────────────────── */}
      {selectedSources.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-foreground">
            Source Configuration
          </p>
          {selectedSources.map(source => (
            <SourceFetchConfigCard
              key={source.id}
              source={source}
              config={
                sourceConfigs[source.id] ?? defaultConfigForKind(source.type)
              }
              onChange={cfg =>
                setSourceConfigs(prev => ({ ...prev, [source.id]: cfg }))
              }
              disabled={isFetching}
            />
          ))}
        </div>
      )}

      {/* ── Fetch Period + Interval ──────────────────────────────────────────── */}
      <div
        className={cn(
          'space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10',
          isFetching && 'pointer-events-none opacity-50',
        )}
      >
        <div className="flex items-center gap-2">
          <ClipboardClock className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">Fetch Period</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(['1min', '5min', '10min', '1h', '1d'] as const).map(p => (
            <button
              key={p}
              type="button"
              onClick={() => handlePresetChange(p)}
              disabled={isFetching}
              className={cn(
                'h-8 rounded-md px-3 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                range === p && !isCustomInterval
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-transparent text-foreground ring-1 ring-border hover:bg-muted',
                isFetching && 'opacity-50 hover:bg-transparent',
              )}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
          <span className="h-4 w-px bg-border" />
          <button
            type="button"
            disabled={isFetching}
            onClick={() => {
              if (isCustomInterval) setCustomInterval(null)
              else {
                setCustomInterval({ value: customValue, unit: customUnit })
                nav.setTimeRange(range)
              }
            }}
            className={cn(
              'h-8 rounded-md px-3 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              isCustomInterval
                ? 'bg-primary text-primary-foreground'
                : 'bg-transparent text-foreground ring-1 ring-border hover:bg-muted',
              isFetching && 'opacity-50 hover:bg-transparent',
            )}
          >
            Custom
          </button>
          {isCustomInterval && (
            <div className="flex items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1">
              <span className="text-xs text-muted-foreground">Every</span>
              <input
                type="number"
                min={1}
                value={customValue}
                disabled={isFetching}
                onChange={e => {
                  const v = Math.max(1, Number(e.target.value))
                  setCustomValue(v)
                  setCustomInterval({ value: v, unit: customUnit })
                  nav.setTimeRange(range)
                }}
                className="h-7 w-14 rounded border border-border bg-background px-1.5 font-mono text-xs"
              />
              <Select
                value={customUnit}
                disabled={isFetching}
                onValueChange={(u: CustomInterval['unit']) => {
                  setCustomUnit(u)
                  setCustomInterval({ value: customValue, unit: u })
                  nav.setTimeRange(range)
                }}
              >
                <SelectTrigger className="h-7 w-16 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="min">min</SelectItem>
                  <SelectItem value="hr">hr</SelectItem>
                  <SelectItem value="day">day</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">Interval</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="mp-fetch-from" className="text-xs">
              Start
            </Label>
            <DateTimePicker
              id="mp-fetch-from"
              value={customFrom}
              max={customTo}
              disabled={isFetching}
              onChange={handleCustomFromChange}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mp-fetch-to" className="text-xs">
              End
            </Label>
            <DateTimePicker
              id="mp-fetch-to"
              value={customTo}
              min={customFrom}
              max={toDateTimeLocal(now)}
              disabled={isFetching}
              onChange={handleCustomToChange}
            />
          </div>
        </div>
        <Button
          className="h-9 w-full"
          variant={isDone ? 'outline' : 'default'}
          onClick={handleFetch}
          disabled={isFetching || fetchTags.length === 0}
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

      {/* ── Body (chart / table) ────────────────────────────────────────────── */}
      {fetch.status === 'error' ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t fetch sensor data</AlertTitle>
          <AlertDescription>{fetch.error}</AlertDescription>
          <Button
            size="sm"
            variant="outline"
            className="mt-2 w-fit"
            onClick={handleFetch}
          >
            <RotateCw className="mr-2 h-3.5 w-3.5" />
            Retry
          </Button>
        </Alert>
      ) : isFetching ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Fetching {fetchTags.length} tag
            {fetchTags.length === 1 ? '' : 's'}…
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
          <p className="text-xs text-muted-foreground">
            {raw.rows.length} rows
          </p>
          <RawReadingsTable dataset={raw} />
        </div>
      ) : (
        /* Idle — wait for an explicit fetch (no auto-fetch on entry) */
        <div className="flex items-start gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              Ready to fetch {fetchTags.length} tag
              {fetchTags.length === 1 ? '' : 's'}
            </p>
            <p className="text-xs text-muted-foreground">
              Set the fetch period and interval above, then click “Fetch Data”
              to load the raw readings.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
