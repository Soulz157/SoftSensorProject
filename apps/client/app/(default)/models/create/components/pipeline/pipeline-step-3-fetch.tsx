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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useModelDatasetFetch } from '@/hooks/model/use-model-dataset-fetch'
import { mpSelectedTagsAtom, mpTimeRangeAtom } from '@/store/model-pipeline'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'

type FetchPeriod = '1min' | '1h' | '1d'

const PERIOD_LABELS: Record<FetchPeriod, string> = {
  '1min': 'Every 1 minute',
  '1h': 'Every 1 hour',
  '1d': 'Every 24 hours',
}

const formatDateTimeLocal = (date: Date) => {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

interface Props {
  nav: UsePipelineNavResult
}

export function PipelineStep3Fetch({ nav }: Props) {
  const selectedTags = useAtomValue(mpSelectedTagsAtom)

  const range = useAtomValue(mpTimeRangeAtom) as FetchPeriod
  const fetch = useModelDatasetFetch()

  const [useCustom, setUseCustom] = useState(false)

  const now = new Date()
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)

  const [customFrom, setCustomFrom] = useState(() =>
    formatDateTimeLocal(oneHourAgo),
  )
  const [customTo, setCustomTo] = useState(() => formatDateTimeLocal(now))

  const isFetching = fetch.status === 'fetching'
  const isDone = fetch.status === 'done'

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

  const handleFetch = () => {
    fetch.start(selectedTags, range)
  }

  useEffect(() => {
    if (isDone && nav.canAdvance(3)) {
      nav.next()
    }
  }, [isDone, nav])

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
          <RotateCw className="h-3.5 w-3.5 mr-2" />
          Retry
        </Button>
      </Alert>
    )
  }

  if (isDone && !nav.canAdvance(3)) {
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
          onClick={() => nav.goTo(2)}
        >
          Back to tag selection
        </Button>
      </Alert>
    )
  }

  return (
    <div className="space-y-5">
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

        {/* Preset Toggles: ใช้ '1min' ตาม Type ที่เราเปลี่ยน */}
        <div className="flex flex-wrap items-center gap-2">
          {(['1min', '1h', '1d'] as const).map(p => (
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
          <div className="w-px h-4 bg-border mx-1" /> {/* Divider */}
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
                className="h-8 text-xs font-mono"
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
                className="h-8 text-xs font-mono"
              />
            </div>
          </div>
        )}
        <p className="font-mono text-xs text-muted-foreground pt-1">
          {useCustom && customFrom && customTo
            ? `${customFrom.replace('T', ' ')} → ${customTo.replace('T', ' ')}`
            : PERIOD_LABELS[range]}
        </p>
      </div>

      <Button
        className="h-10 w-full"
        onClick={handleFetch}
        disabled={isFetching || selectedTags.length === 0}
      >
        {isFetching ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Fetching…
          </>
        ) : (
          <>
            <Download className="h-4 w-4 mr-2" />
            Fetch Data
          </>
        )}
      </Button>

      {fetch.status === 'idle' ? (
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
        <div className="flex items-center gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
          <p className="text-sm text-foreground">
            Complete — moving to Raw Data…
          </p>
        </div>
      ) : (
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
