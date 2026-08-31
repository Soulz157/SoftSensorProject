'use client'

import { useAtom, useAtomValue } from 'jotai'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarRange,
  CheckCircle2,
  CircleDot,
  ClipboardClock,
  Download,
  Eye,
  FileDown,
  FileSpreadsheet,
  Info,
  Loader2,
  RotateCw,
  XCircle,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { DateTimePicker, toDateTimeLocal } from '@/components/date-time-picker'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useCsvMaterialize } from '@/hooks/dataset/use-csv-materialize'
import { useDatasetStudioFetch } from '@/hooks/dataset/use-dataset-studio-fetch'
import { useDatasetStudioPreview } from '@/hooks/dataset/use-dataset-studio-preview'
import { useSourceConnectionVerify } from '@/hooks/dataset/use-source-connection-verify'
import { ConnectionVerifyPanel } from './source-configs/connection-verify-panel'
import {
  dwBronzeWarmStateAtom,
  dwCustomIntervalAtom,
  dwFetchConfigAtom,
  dwNameAtom,
  dwRawDatasetAtom,
  dwSelectedSourcesAtom,
  dwSelectedTagsAtom,
  dwSourceFetchConfigsAtom,
  dwTagConstantsAtom,
} from '@/store/dataset-studio'
import type { CustomInterval, FetchPeriod } from '@/store/model-pipeline'
import { formatElapsed, resolveInterval } from '@/lib/dataset-fetch'
import { FetchElapsed } from './fetch-elapsed'
import { datasetToCsv, datasetCsvFilename } from '@/lib/csv'
import { datasetQuality } from '@/lib/data-quality'
import { HistoricalFetchConfigCard } from './source-configs/historical-fetch-config-card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RawReadingsTable } from './raw-readings-table'
import { EditLockBanner } from './step-1-tags'
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

/** Compact "time remaining" label for the batched-fetch ETA. */
function formatEta(ms: number | null): string {
  if (ms === null || ms <= 0) return ''
  const totalSec = Math.round(ms / 1000)
  if (totalSec < 60) return `~${totalSec}s left`
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return sec > 0 ? `~${min}m ${sec}s left` : `~${min}m left`
}

interface Props {
  nav: UseDatasetPipelineNavResult
}

export function Step2RawData({ nav }: Props) {
  // The tags the user checked in Step 1 (dwSelectedTagsAtom) are exactly what
  // we fetch — no separate fetch-subset sentinel.
  const fetchTags = useAtomValue(dwSelectedTagsAtom)
  const tagConstants = useAtomValue(dwTagConstantsAtom)
  const constantTags = useMemo(() => Object.keys(tagConstants), [tagConstants])

  const range = nav.timeRange
  const raw = useAtomValue(dwRawDatasetAtom)
  const fetch = useDatasetStudioFetch()
  // All-CSV runs need no fetch — this materializes the uploaded file into the
  // raw dataset and settles the fetch state, so the step gate passes untouched.
  const csv = useCsvMaterialize()
  const preview = useDatasetStudioPreview()
  const verify = useSourceConnectionVerify()
  const [customInterval, setCustomInterval] = useAtom(dwCustomIntervalAtom)

  const selectedSources = useAtomValue(dwSelectedSourcesAtom)

  const [sourceConfigs, setSourceConfigs] = useAtom(dwSourceFetchConfigsAtom)
  const [fetchConfig, setFetchConfig] = useAtom(dwFetchConfigAtom)

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

  const locked = nav.isEditLocked
  const isFetching = fetch.status === 'fetching'
  const isDone = fetch.status === 'done'
  // DS-LAKE-015-T04: `fetch.status === 'done'` only means the CLIENT-side
  // batches landed — `useDatasetBronzeWarm`'s background materialize (fired
  // from inside `useDatasetStudioFetch` right after this same 'done'
  // transition) can still be running when this card renders. Say so, so
  // "Dataset ready" doesn't read as "Step 3.1 is ready too".
  const bronzeWarmState = useAtomValue(dwBronzeWarmStateAtom)
  // Edit mode freezes the raw query — disable every fetch control (but keep the
  // hydrated raw table visible, unlike an in-flight fetch).
  const controlsDisabled = isFetching || locked
  // CSV bypass applies to a live create run only. Edit mode rebuilds the grid
  // from the saved recipe and keeps its own locked fetch surface, so it must
  // keep rendering the original controls even when every source is a CSV.
  const csvBypass = !csv.fetchRequired && !locked

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

  // Preview never advances the wizard — it's a cheap check before the full run.
  const handlePreview = () => preview.run(fetchTags, range)
  const isPreviewing = preview.status === 'loading'

  const { next } = nav

  // ── Dataset Ready (Step 8): summary of the fetched grid + CSV export. ────────
  // `datasetQuality` is O(rows × tags) and P6 can produce a large grid, so
  // memoize. Missing counts are real because P6's mergeDataset backfills holes
  // as Bad — not an artifact.
  const quality = useMemo(() => datasetQuality(raw), [raw])
  const effectiveInterval =
    fetchConfig.summaryDuration.trim() || resolveInterval(range, customInterval)
  const datasetName = useAtomValue(dwNameAtom)

  const handleDownloadCsv = () => {
    if (raw.rows.length === 0) return
    const csvText = datasetToCsv(raw)
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = datasetCsvFilename(datasetName, range)
    a.click()
    URL.revokeObjectURL(url)
  }

  useEffect(() => {
    if (fetch.status === 'done' && advanceOnDone.current) {
      advanceOnDone.current = false
      next()
    }
  }, [fetch.status, next])

  return (
    <div className="space-y-5">
      {locked && (
        <EditLockBanner>
          Time range and fetch settings are locked while editing preprocessing.
          The raw readings below are the originally saved query.
        </EditLockBanner>
      )}

      {/* ── Verify connection (Step 2) — reuses F6 test-connection ──────────── */}
      <ConnectionVerifyPanel
        sources={selectedSources.filter(s => s.type === 'aveva')}
        statusFor={verify.statusFor}
        onVerify={verify.verify}
        disabled={controlsDisabled}
      />

      {/* ── CSV source validation — replaces fetch configuration entirely ──── */}
      {csvBypass && csv.hasCsvData && (
        <div className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">
              CSV Dataset Ready
            </p>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              {csv.csvTagCount} column{csv.csvTagCount === 1 ? '' : 's'} ·{' '}
              {csv.csvRowCount.toLocaleString()} row
              {csv.csvRowCount === 1 ? '' : 's'}
            </span>
          </div>
          {csv.fileName && (
            <p className="truncate font-mono text-xs text-muted-foreground">
              {csv.fileName}
            </p>
          )}
          <div className="flex items-start gap-2 rounded-md bg-muted p-2.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              This dataset comes from a CSV file and does not require data
              fetching. CSV uploaded successfully — ready to continue.
            </span>
          </div>
        </div>
      )}

      {/* ── Per-source fetch configuration ─────────────────────────────────── */}
      {!csvBypass && selectedSources.length > 0 && (
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
              disabled={controlsDisabled}
            />
          ))}
        </div>
      )}

      {/* ── Fetch Period + Interval — only for sources that need fetching ───── */}
      {!csvBypass && (
        <div
          className={cn(
            'space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10',
            controlsDisabled && 'pointer-events-none opacity-50',
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
      )}

      {/* ── PI historical-fetch summary settings ─────────────────────────────── */}
      {selectedSources.some(s => s.type === 'aveva') && (
        <HistoricalFetchConfigCard
          config={fetchConfig}
          onChange={setFetchConfig}
          derivedDuration={resolveInterval(range, customInterval)}
          disabled={controlsDisabled}
        />
      )}

      {/* ── Preview (first ~100 rows) — own block, not in the fetch-status chain
           so it stays visible while idle (when it matters) and after a real
           fetch completes. ────────────────────────────────────────────────── */}
      {selectedSources.some(s => s.type === 'aveva') && (
        <div className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">
                Preview first 100 rows
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handlePreview}
              disabled={
                controlsDisabled || isPreviewing || fetchTags.length === 0
              }
            >
              {isPreviewing ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Loading…
                </>
              ) : (
                <>
                  <Eye className="mr-2 h-3.5 w-3.5" />
                  {preview.status === 'done' ? 'Refresh preview' : 'Preview'}
                </>
              )}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            A small sample from the start of the time range — check values and
            quality before running the full fetch.
          </p>

          {preview.notice && (
            <div className="flex items-start gap-2 rounded-md bg-muted p-2.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{preview.notice}</span>
            </div>
          )}

          {preview.status === 'error' ? (
            <Alert variant="destructive">
              <AlertTitle>Couldn&apos;t load preview</AlertTitle>
              <AlertDescription>{preview.error}</AlertDescription>
            </Alert>
          ) : isPreviewing ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : preview.status === 'done' && preview.dataset ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {preview.dataset.rows.length} sample row
                {preview.dataset.rows.length === 1 ? '' : 's'}
              </p>
              <RawReadingsTable
                dataset={preview.dataset}
                ignoreTags={constantTags}
              />
            </div>
          ) : null}
        </div>
      )}

      {/* ── Body (chart / table) ────────────────────────────────────────────── */}
      {/* Fetch errors belong to fetch-required sources only — a CSV run never
          calls the API, so its state can never legitimately be an error. */}
      {!csvBypass && fetch.status === 'error' ? (
        <div className="space-y-3">
          <Alert variant="destructive">
            <AlertTitle>Couldn&apos;t fetch sensor data</AlertTitle>
            <AlertDescription>{fetch.error}</AlertDescription>
            <div className="mt-2 flex flex-wrap gap-2">
              {fetch.detail.failedBatches.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-fit"
                  onClick={() => fetch.retryFailed(fetchTags, range)}
                >
                  <RotateCw className="mr-2 h-3.5 w-3.5" />
                  Retry {fetch.detail.failedBatches.length} failed batch
                  {fetch.detail.failedBatches.length === 1 ? '' : 'es'}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="w-fit"
                onClick={handleFetch}
              >
                <Download className="mr-2 h-3.5 w-3.5" />
                Re-fetch all
              </Button>
            </div>
          </Alert>
          {/* Partial data the succeeded batches DID return — never swallowed. */}
          {raw.rows.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Partial: {raw.rows.length} row
                {raw.rows.length === 1 ? '' : 's'} from{' '}
                {fetch.detail.completedTags}/{fetch.detail.totalTags} tags
              </p>
              <RawReadingsTable dataset={raw} ignoreTags={constantTags} />
            </div>
          )}
        </div>
      ) : isFetching ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Fetching batch{' '}
              {Math.min(
                fetch.detail.completedBatches + 1,
                fetch.detail.totalBatches,
              )}
              /{fetch.detail.totalBatches} · {fetch.detail.completedTags}/
              {fetch.detail.totalTags} tags
              {formatEta(fetch.detail.etaMs)
                ? ` · ${formatEta(fetch.detail.etaMs)}`
                : ''}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="w-fit"
              onClick={fetch.cancel}
            >
              <XCircle className="mr-2 h-3.5 w-3.5" />
              Cancel
            </Button>
          </div>
          {/* Progress is a generated shadcn component — composed around, never
              edited. The clock sits on the same row so elapsed time reads as
              part of the bar. */}
          <div className="flex items-center gap-3">
            <Progress value={fetch.progress} className="flex-1" />
            {fetch.detail.startedAt !== null && (
              <FetchElapsed startedAt={fetch.detail.startedAt} />
            )}
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {Math.round(fetch.progress)}%
            </span>
          </div>
          {/* Show partial rows as batches land; skeleton only before the first. */}
          {raw.rows.length > 0 ? (
            <RawReadingsTable dataset={raw} ignoreTags={constantTags} />
          ) : (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          )}
        </div>
      ) : isDone ? (
        <div className="space-y-3">
          {/* ── Dataset Ready (Step 8) — summary of the fetched grid + CSV ───── */}
          <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                <p className="text-sm font-medium text-foreground">
                  Dataset ready
                </p>
                {/* Frozen total for the run. Both stamps are required: edit
                    mode hydrates status 'done' with no progress detail, and
                    that must render nothing rather than "00:00:00". */}
                {fetch.detail.startedAt !== null &&
                  fetch.detail.finishedAt !== null && (
                    <span className="text-xs text-muted-foreground">
                      Fetched in{' '}
                      <span className="font-mono tabular-nums">
                        {formatElapsed(
                          fetch.detail.finishedAt - fetch.detail.startedAt,
                        )}
                      </span>
                    </span>
                  )}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="w-fit"
                onClick={handleDownloadCsv}
                disabled={raw.rows.length === 0}
              >
                <FileDown className="mr-2 h-3.5 w-3.5" />
                Download CSV
              </Button>
            </div>

            {bronzeWarmState === 'materializing' && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Still preparing this dataset in the background — Step 3.1 will
                show a loading state until it’s ready.
              </p>
            )}

            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Tags</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                  {raw.tags.length}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Records</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                  {raw.rows.length.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Interval</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                  {effectiveInterval}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Missing</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                  {quality.missing.toLocaleString()}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    ({quality.missingPct.toFixed(1)}%)
                  </span>
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Good cells</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                  {(100 - quality.missingPct - quality.suspectPct).toFixed(1)}%
                </p>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <p className="text-xs text-muted-foreground">Time range</p>
                <p className="mt-0.5 truncate text-xs font-medium text-foreground">
                  {nav.customDateRange
                    ? `${nav.customDateRange.from.replace('T', ' ')} → ${nav.customDateRange.to.replace('T', ' ')}`
                    : '—'}
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : csvBypass ? (
        /* CSV with nothing uploaded yet — Step 1 owns the file. */
        <div className="flex items-start gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              No CSV data yet
            </p>
            <p className="text-xs text-muted-foreground">
              Go back to Verified Tags and use “Upload CSV” to load the file.
              Its columns become the dataset tags — no fetching required.
            </p>
          </div>
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
