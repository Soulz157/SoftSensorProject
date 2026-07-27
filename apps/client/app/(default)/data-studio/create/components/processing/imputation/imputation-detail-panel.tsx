'use client'

import {
  ArrowRight,
  Info,
  Plus,
  Trash2,
  Settings2,
  Play,
  Activity,
  Scissors,
  Waves,
  Eraser,
  Droplets,
} from 'lucide-react'
import { useState } from 'react'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

import { tagSeverity, type TagQuality } from '@/lib/data-quality'
import { resolveTagMeta, type TimeRange } from '@/lib/mock-readings'
import type {
  CleaningCategory,
  CleaningMethod,
  CleaningStep,
  TagFillPreviewRow,
} from '@/lib/preprocessing'
import { BadDataBreakdown } from '../../bad-data-breakdown'
import { ImputationTrendChart } from './imputation-trend-chart'
import { ImputationComparisonHistogram } from './imputation-comparison-histogram'

interface Props {
  pipeline: CleaningStep[]
  onPipelineChange: (next: CleaningStep[]) => void
  previewIndex: number
  onPreviewIndexChange: (index: number) => void
  /** Before/After rows for `isolatedTag`, truncated to `previewIndex` steps. */
  previewRows: TagFillPreviewRow[]
  range: TimeRange
  cleaningTags: string[]
  isolatedTag: string
  onIsolate: (tag: string) => void
  quality?: TagQuality
}

interface ToolkitItem {
  method: CleaningMethod
  label: string
  icon: React.ElementType
  /** Numeric param label (maps to `CleaningStep.param`). */
  paramLabel?: string
  /** Low-bound param label (maps to `CleaningStep.paramLow`) — clip only. */
  paramLowLabel?: string
  defaultParam?: number
  defaultParamLow?: number
}

const CATEGORY_ICONS: Record<CleaningCategory, React.ElementType> = {
  missing: Eraser,
  outliers: Scissors,
  smoothing: Waves,
}

const TAB_LABELS: Record<CleaningCategory, string> = {
  missing: 'Missing',
  outliers: 'Outliers',
  smoothing: 'Smooth',
}

const TOOLKIT: Record<CleaningCategory, ToolkitItem[]> = {
  missing: [
    { method: 'drop', label: 'Drop Missing Rows', icon: Eraser },
    { method: 'mean', label: 'Fill Mean', icon: Droplets },
    { method: 'median', label: 'Fill Median', icon: Droplets },
    { method: 'forward', label: 'Forward Fill', icon: Droplets },
    { method: 'backward', label: 'Backward Fill', icon: Droplets },
    { method: 'interpolate', label: 'Interpolate', icon: Droplets },
    {
      method: 'constant',
      label: 'Constant Value',
      icon: Droplets,
      paramLabel: 'Value',
      defaultParam: 0,
    },
  ],
  outliers: [
    {
      method: 'zscore',
      label: 'Remove (Z-Score)',
      icon: Scissors,
      paramLabel: 'Threshold',
      defaultParam: 3,
    },
    {
      // No default bounds — clipping is a no-op until the user sets Min/Max, so
      // adding the step never silently flattens the series to zero.
      method: 'clip',
      label: 'Clip Bounds',
      icon: Scissors,
      paramLowLabel: 'Min',
      paramLabel: 'Max',
    },
    { method: 'outlier_median', label: 'Replace with Median', icon: Scissors },
  ],
  smoothing: [
    {
      method: 'moving_avg',
      label: 'Moving Average',
      icon: Waves,
      paramLabel: 'Window',
      defaultParam: 3,
    },
    {
      method: 'exponential',
      label: 'Exponential',
      icon: Waves,
      paramLabel: 'Alpha',
      defaultParam: 0.3,
    },
  ],
}

const ITEM_BY_METHOD: Record<string, ToolkitItem> = Object.fromEntries(
  (Object.values(TOOLKIT).flat() as ToolkitItem[]).map(item => [
    item.method,
    item,
  ]),
)

/**
 * Cleaning Toolkit + Strategy Stack + a single-tag, step-by-step Before/After
 * preview (scrub Raw → Step 1 → … to see each strategy's effect on the
 * isolated tag). The multi-tag overlay preview lives in the CutOffSection below.
 */
export function ImputationDetailPanel({
  pipeline,
  onPipelineChange,
  previewIndex,
  onPreviewIndexChange,
  previewRows,
  range,
  cleaningTags,
  isolatedTag,
  onIsolate,
  quality,
}: Props) {
  const label = resolveTagMeta(isolatedTag)?.label || 'Sensor Data'
  const severity = quality ? tagSeverity(quality) : 'clean'
  const missingRows = quality ? quality.missing + quality.suspect : 0

  // Toolkit clicks stage a step here and open a confirm dialog; the step is only
  // committed to the pipeline once the user confirms.
  const [pending, setPending] = useState<{
    item: ToolkitItem
    category: CleaningCategory
  } | null>(null)

  const addStep = (item: ToolkitItem, category: CleaningCategory) => {
    const step: CleaningStep = {
      uid: crypto.randomUUID(),
      category,
      method: item.method,
      param: item.defaultParam,
      paramLow: item.defaultParamLow,
    }
    onPipelineChange([...pipeline, step])
    onPreviewIndexChange(pipeline.length + 1)
  }

  const removeStep = (uid: string) => {
    const next = pipeline.filter(step => step.uid !== uid)
    onPipelineChange(next)
    if (previewIndex > next.length) onPreviewIndexChange(next.length)
  }

  const setParam = (uid: string, key: 'param' | 'paramLow', val: number) => {
    onPipelineChange(
      pipeline.map(step => (step.uid === uid ? { ...step, [key]: val } : step)),
    )
  }

  const before = previewRows
    .map(r => r.before)
    .filter((v): v is number => v !== null)
  const after = previewRows
    .map(r => r.after)
    .filter((v): v is number => v !== null)

  const previewLabel =
    previewIndex === 0
      ? 'Original Data'
      : `Result after ${ITEM_BY_METHOD[pipeline[previewIndex - 1]?.method ?? '']?.label ?? 'step'}`

  return (
    <div className="space-y-6 text-foreground">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="text-[10px] font-semibold text-muted-foreground">
            Cleaning Pipeline
          </span>
          <h2 className="text-lg font-semibold text-foreground">
            {cleaningTags.length} {cleaningTags.length === 1 ? 'tag' : 'tags'}{' '}
            selected
          </h2>
          <p className="text-xs text-muted-foreground">
            Step preview shown for{' '}
            <span className="font-mono">{isolatedTag}</span> · {label}
          </p>
        </div>

        {quality && severity !== 'clean' && (
          <div className="flex items-center gap-1 rounded-full bg-purple-500/15 px-2.5 py-0.5 text-xs font-medium text-purple-600 dark:text-purple-400">
            <span>Bad Data: {missingRows} rows</span>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={`View bad data breakdown for ${isolatedTag}`}
                  className="rounded-full p-0.5 transition-colors hover:bg-purple-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/40"
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-64 border-border bg-card p-3"
              >
                <BadDataBreakdown
                  tag={isolatedTag}
                  badCount={missingRows}
                  detail={{
                    bad: quality.missing,
                    questionable: quality.suspect,
                  }}
                />
              </PopoverContent>
            </Popover>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="flex flex-col gap-6 xl:col-span-4">
          {/* Cleaning Toolkit */}
          <div className="w-full rounded-xl border border-border bg-card/50 p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Settings2 className="h-4 w-4 text-primary" />
              Cleaning Toolkit
            </h3>
            <Tabs defaultValue="missing" className="flex w-full flex-col">
              <TabsList className="mb-4 grid h-auto w-full grid-cols-3 bg-background/50 p-1">
                {(Object.keys(TOOLKIT) as CleaningCategory[]).map(category => (
                  <TabsTrigger
                    key={category}
                    value={category}
                    className="cursor-pointer py-1.5 text-[11px]"
                  >
                    {TAB_LABELS[category]}
                  </TabsTrigger>
                ))}
              </TabsList>

              {(Object.keys(TOOLKIT) as CleaningCategory[]).map(category => (
                <TabsContent
                  key={category}
                  value={category}
                  className="mt-0 space-y-2"
                >
                  {TOOLKIT[category].map(item => {
                    const ItemIcon = item.icon
                    return (
                      <button
                        key={item.method}
                        onClick={() => setPending({ item, category })}
                        className="group flex w-full cursor-pointer items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-sm transition-colors hover:border-primary/50 hover:bg-primary/5"
                      >
                        <span className="flex items-center gap-2 text-muted-foreground transition-colors group-hover:text-foreground">
                          <ItemIcon className="h-4 w-4 text-primary" />
                          {item.label}
                        </span>
                        <Plus className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
                      </button>
                    )
                  })}
                </TabsContent>
              ))}
            </Tabs>
          </div>

          {/* Strategy Stack */}
          <div className="flex min-h-75 w-full flex-col rounded-xl border border-border bg-card p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Activity className="h-4 w-4 text-primary" />
              Strategy Stack
            </h3>

            <div className="flex-1 space-y-3 overflow-y-auto p-2 pr-2">
              {pipeline.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-border p-4 text-center">
                  <p className="text-xs text-muted-foreground">
                    No strategies applied yet.
                    <br />
                    Add steps from the toolkit above.
                  </p>
                </div>
              ) : (
                pipeline.map((step, idx) => {
                  const item = ITEM_BY_METHOD[step.method]
                  const StepIcon =
                    item?.icon || CATEGORY_ICONS[step.category] || Activity
                  return (
                    <div
                      key={step.uid}
                      className="relative flex flex-col gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm ring-2 ring-background">
                            <span className="text-[10px] font-semibold">
                              {idx + 1}
                            </span>
                          </div>
                          <span className="flex items-center gap-1.5 text-sm font-medium">
                            <StepIcon className="h-3.5 w-3.5 text-primary" />
                            {item?.label ?? step.method}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeStep(step.uid)}
                          aria-label="Remove step"
                          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {(item?.paramLowLabel || item?.paramLabel) && (
                        <div className="flex items-center gap-2 pl-9">
                          {item.paramLowLabel && (
                            <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                              {item.paramLowLabel}
                              <Input
                                type="number"
                                value={step.paramLow ?? ''}
                                onChange={e =>
                                  setParam(
                                    step.uid,
                                    'paramLow',
                                    Number(e.target.value),
                                  )
                                }
                                className="h-7 w-20 text-xs"
                              />
                            </label>
                          )}
                          {item.paramLabel && (
                            <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                              {item.paramLabel}
                              <Input
                                type="number"
                                value={step.param ?? ''}
                                onChange={e =>
                                  setParam(
                                    step.uid,
                                    'param',
                                    Number(e.target.value),
                                  )
                                }
                                className="h-7 w-20 text-xs"
                              />
                            </label>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>

        {/* Step-by-step preview (single isolated tag) */}
        <div className="flex flex-col gap-4 xl:col-span-8">
          <div className="flex flex-wrap items-center rounded-xl border border-border bg-card p-3">
            <span className="mr-2 text-xs font-semibold text-muted-foreground">
              Preview Step:
            </span>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-background p-1">
              <button
                onClick={() => onPreviewIndexChange(0)}
                className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                  previewIndex === 0
                    ? 'bg-primary/20 text-primary shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Raw Data
              </button>
              {pipeline.map((step, idx) => (
                <div
                  key={`nav-${step.uid}`}
                  className="flex items-center gap-1"
                >
                  <ArrowRight className="mx-1 h-3 w-3 text-border" />
                  <button
                    onClick={() => onPreviewIndexChange(idx + 1)}
                    className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                      previewIndex === idx + 1
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Step {idx + 1}
                  </button>
                </div>
              ))}
            </div>

            <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
              <Play className="h-3 w-3" />
              Showing: {previewLabel}
            </div>
          </div>

          <div className="min-h-75 flex-1 rounded-xl border border-border bg-card p-4">
            <ImputationTrendChart
              rows={previewRows}
              tags={cleaningTags}
              isolatedTag={isolatedTag}
              onIsolate={onIsolate}
              range={range}
            />
          </div>

          <div className="h-62.5 rounded-xl border border-border bg-card p-4">
            <h3 className="mb-4 text-sm font-semibold text-foreground">
              Distribution Comparison
            </h3>
            <ImputationComparisonHistogram
              before={before}
              after={after}
              tag={isolatedTag}
            />
          </div>
        </div>
      </div>

      <AlertDialog
        open={pending !== null}
        onOpenChange={open => {
          if (!open) setPending(null)
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Add “{pending?.item.label}” to the pipeline?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This step joins the shared cleaning pipeline and applies to all{' '}
              {cleaningTags.length} {cleaningTags.length === 1 ? 'tag' : 'tags'}{' '}
              selected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pending) addStep(pending.item, pending.category)
                setPending(null)
              }}
            >
              Add step
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
