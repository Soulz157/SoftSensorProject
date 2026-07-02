'use client'

import { useEffect, useState } from 'react'
import { useAtomValue } from 'jotai'
import {
  RotateCw,
  CalendarRange,
  Download,
  Loader2,
  CircleDot,
  CheckCircle2,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { DateTimePicker, toDateTimeLocal } from '@/components/ui/Datetime'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useDatasetFetch } from '@/hooks/use-dataset-fetch'
import { selectedTagsAtom, timeRangeAtom } from '@/store/data-visualize'
import { TimeRangeToggle } from './time-range-toggle'
import type { useWizardNavigation } from '@/hooks/use-wizard-navigation'
import type { TimeRange } from '@/lib/mock-readings'

interface Props {
  nav: ReturnType<typeof useWizardNavigation>
}

const RANGE_LABEL: Record<TimeRange, string> = {
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '1m': 'Last 30 days',
  '1y': 'Last 12 months',
}

export function Step4Fetching({ nav }: Props) {
  const selectedTags = useAtomValue(selectedTagsAtom)
  const range = useAtomValue(timeRangeAtom)
  const fetch = useDatasetFetch()

  const [useCustom, setUseCustom] = useState(false)
  const [customFrom, setCustomFrom] = useState(() =>
    toDateTimeLocal(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
  )
  const [customTo, setCustomTo] = useState(() => toDateTimeLocal(new Date()))

  const isFetching = fetch.status === 'fetching'
  const isDone = fetch.status === 'done'

  const handlePresetChange = (r: TimeRange) => {
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

  const handleFetch = () => {
    fetch.start(selectedTags, range)
  }

  // Auto-advance to Step 5 once fetch completes with data
  useEffect(() => {
    if (isDone && nav.canAdvance(4)) {
      nav.next()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDone])

  // ── Error state ───────────────────────────────────────────────────────────
  if (fetch.status === 'error') {
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn&apos;t fetch sensor data</AlertTitle>
        <AlertDescription>{fetch.error}</AlertDescription>
        <Button
          size="sm"
          variant="outline"
          className="mt-2 w-fit"
          onClick={() => fetch.retry(selectedTags, range)}
        >
          <RotateCw className="h-3.5 w-3.5" />
          Retry
        </Button>
      </Alert>
    )
  }

  // ── No-data state (done but empty) ────────────────────────────────────────
  if (isDone && !nav.canAdvance(4)) {
    return (
      <Alert>
        <AlertTitle>No data in range</AlertTitle>
        <AlertDescription>
          Try extending the time range, or pick different tags.
        </AlertDescription>
        <Button
          size="sm"
          variant="outline"
          className="mt-2 w-fit"
          onClick={() => nav.goTo(3)}
        >
          Back to tags &amp; range
        </Button>
      </Alert>
    )
  }

  return (
    <div className="space-y-5">
      {/* Period selector */}
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
          <TimeRangeToggle
            value={range}
            onChange={handlePresetChange}
            disabled={useCustom || isFetching}
          />
          <button
            type="button"
            onClick={handleCustomToggle}
            disabled={isFetching}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              useCustom
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            Custom
          </button>
        </div>

        {useCustom && (
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="fetch-from" className="text-xs">
                From
              </Label>
              <DateTimePicker
                id="fetch-from"
                value={customFrom}
                max={customTo}
                onChange={handleCustomFromChange}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="fetch-to" className="text-xs">
                To
              </Label>
              <DateTimePicker
                id="fetch-to"
                value={customTo}
                min={customFrom}
                max={toDateTimeLocal(new Date())}
                onChange={handleCustomToChange}
              />
            </div>
          </div>
        )}

        <p className="font-mono text-xs text-muted-foreground">
          {useCustom && customFrom && customTo
            ? `${customFrom} → ${customTo}`
            : RANGE_LABEL[range]}
        </p>
      </div>

      {/* Fetch action button */}
      <Button
        className="h-10 w-full"
        onClick={handleFetch}
        disabled={isFetching || selectedTags.length === 0}
      >
        {isFetching ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Fetching…
          </>
        ) : (
          <>
            <Download className="h-4 w-4" />
            Fetch Data
          </>
        )}
      </Button>

      {/* Stage-dependent body */}
      {fetch.status === 'idle' ? (
        /* Stage 1 — placeholder */
        <div className="flex items-start gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              Ready to fetch {selectedTags.length} tag
              {selectedTags.length === 1 ? '' : 's'}
            </p>
            <p className="text-xs text-muted-foreground">
              Configure the period above, then click &ldquo;Fetch Data&rdquo; to
              begin.
            </p>
          </div>
        </div>
      ) : isDone ? (
        /* Stage 3 — transitioning */
        <div className="flex items-center gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
          <p className="text-sm text-foreground">
            Complete — moving to Raw Data…
          </p>
        </div>
      ) : (
        /* Stage 2 — progress + skeletons */
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
      )}
    </div>
  )
}
