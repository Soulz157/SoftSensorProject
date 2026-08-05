'use client'

import { useMemo, useState } from 'react'
import { CheckCheck, Eye, Plus, X } from 'lucide-react'
import { toChartRows, type Dataset } from '@/lib/preprocessing'
import type {
  ConditionalRule,
  CropRange,
  PrecleanseRemoved,
  RangeExclusion,
  StatisticalRule,
  ValueClip,
  ValueCrop,
} from '@/lib/precleanse'
import {
  chartColorVar,
  resolveTagMeta,
  type TimeRange,
} from '@/lib/mock-readings'
import { RawTrendChart } from './chart/raw-data-chart'
import { DataCroppingChart } from './data-cropping-chart'
import { CutoffSidebar } from './cutoff-sidebar'
import { Button } from '@/components/ui/button'
import {
  PopoverContent,
  PopoverTrigger,
  Popover,
} from '@/components/ui/popover'
import { SegmentedToggle } from '@/app/(default)/data-visualize/components/segmented-toggle'

interface Props {
  raw: Dataset
  precleansed: Dataset
  range: TimeRange
  cropRange: CropRange
  onCropChange: (range: CropRange) => void
  valueCrop: ValueCrop
  onValueCropChange: (crop: ValueCrop) => void
  valueClip: ValueClip
  onValueClipChange?: (clip: ValueClip) => void
  exclusions?: RangeExclusion[]
  onExcludeRange?: (exclusion: RangeExclusion) => void
  onClearExclusions?: () => void
  scopeTag?: string
  breakdown: {
    removed: PrecleanseRemoved
    keptRows: number
    totalRows: number
  }
  croppedDataset: Dataset
  conditionalRules: ConditionalRule[]
  statisticalRules: StatisticalRule[]
  onConditionalChange: (rules: ConditionalRule[]) => void
  onStatisticalChange: (rules: StatisticalRule[]) => void
  stepPreviewDataset?: Dataset
  previewStepIndex?: number
  previewStepCount?: number
  previewTags?: string[]
  onPreviewTagsChange?: (tags: string[]) => void
}

type Preview = 'raw' | 'cleaned'

/** Project a dataset down to a single tag's column (rows/timestamps unchanged). */
function pickTag(ds: Dataset, tag: string): Dataset {
  return {
    tags: [tag],
    rows: ds.rows.map(r => ({
      timestamp: r.timestamp,
      cells: { [tag]: r.cells[tag]! },
    })),
  }
}

/**
 * Center "chart" zone of the Step 3.2 cleaning view: the drag-to-crop chart
 * plus a local Before/After preview. Outlier/condition rules live in the right
 * `CutoffSidebar`, not here. The preview is local to this section — it does NOT
 * affect the live `precleansed` state used elsewhere.
 */
export function CutOffSection({
  raw,
  precleansed,
  range,
  cropRange,
  onCropChange,
  valueCrop,
  onValueCropChange,
  valueClip,
  onValueClipChange,
  exclusions = [],
  onExcludeRange,
  onClearExclusions,
  scopeTag,
  breakdown,
  croppedDataset,
  conditionalRules,
  statisticalRules,
  onConditionalChange,
  onStatisticalChange,
  stepPreviewDataset,
  previewStepIndex = 0,
  previewStepCount = 0,
  previewTags = [],
  onPreviewTagsChange = () => {},
}: Props) {
  const [preview, setPreview] = useState<Preview>('cleaned')
  const [isCutoffOpen, setIsCutoffOpen] = useState(true)

  const rawTimestamps = useMemo(() => raw.rows.map(r => r.timestamp), [raw])

  const afterDataset = stepPreviewDataset ?? precleansed
  const previewDataset = preview === 'raw' ? raw : afterDataset

  const selectableTags = raw.tags
  const addable = selectableTags.filter(t => !previewTags.includes(t))
  const addTag = (tag: string) => onPreviewTagsChange([...previewTags, tag])
  const removeTag = (tag: string) =>
    onPreviewTagsChange(previewTags.filter(t => t !== tag))
  const selectAll = () => onPreviewTagsChange([...selectableTags])

  const chartRaw = scopeTag ? pickTag(raw, scopeTag) : raw
  const chartCleaned = scopeTag ? pickTag(precleansed, scopeTag) : precleansed

  // Render exactly the tags the user picked — no fallback. Empty preview → the
  // chart renders its own "select tags" empty state instead of showing tags the
  // user didn't choose.
  const tagsToRender = previewTags

  // Focus highlight: dim every line except the scoped tag, and render the
  // scoped line last so recharts draws it on top. Only focus when the scope is
  // actually on the chart (else the guard would dim all lines to 0.2).
  const focus = scopeTag && tagsToRender.includes(scopeTag) ? scopeTag : ''
  const orderedTags = focus
    ? [...tagsToRender.filter(t => t !== focus), focus]
    : tagsToRender

  const clearTags = () => onPreviewTagsChange(scopeTag ? [scopeTag] : [])
  return (
    <div className="space-y-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="space-y-6">
        {/* Main Content (Charts) */}
        <div className="min-w-0 space-y-4">
          <h2 className="text-sm font-medium text-foreground">
            Data Cut-Off &amp; Cleansing
            {scopeTag && (
              <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                {scopeTag}
              </span>
            )}
          </h2>

          <DataCroppingChart
            rawDataset={chartRaw}
            chartDataset={chartCleaned}
            cropRange={cropRange}
            onCropChange={onCropChange}
            valueCrop={valueCrop}
            onValueCropChange={onValueCropChange}
            exclusions={exclusions}
            onExcludeRange={onExcludeRange}
            onClearExclusions={onClearExclusions}
            valueClip={valueClip}
            onValueClipChange={onValueClipChange}
            scopeTag={scopeTag}
          />

          <CutoffSidebar
            isOpen={isCutoffOpen}
            onToggle={() => setIsCutoffOpen(o => !o)}
            removed={breakdown.removed}
            keptRows={breakdown.keptRows}
            totalRows={breakdown.totalRows}
            tags={raw.tags}
            previewDataset={croppedDataset}
            rawTimestamps={rawTimestamps}
            cropRange={cropRange}
            onCropChange={onCropChange}
            conditionalRules={conditionalRules}
            statisticalRules={statisticalRules}
            onConditionalChange={onConditionalChange}
            onStatisticalChange={onStatisticalChange}
            scopeTag={scopeTag}
          />

          <div className="flex items-center justify-between border-t border-border/60 pt-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Eye className="h-3.5 w-3.5" />
              Preview result
              {preview === 'cleaned' && previewStepCount > 0 && (
                <span className="font-mono text-[11px] text-primary">
                  ·{' '}
                  {previewStepIndex > 0
                    ? `after step ${previewStepIndex} / ${previewStepCount}`
                    : 'no steps applied'}
                </span>
              )}
            </div>
            <SegmentedToggle
              ariaLabel="Preview dataset"
              value={preview}
              onChange={setPreview}
              options={[
                { value: 'raw', label: 'Before Clean' },
                { value: 'cleaned', label: 'After Clean' },
              ]}
            />
          </div>

          <div className="flex flex-col gap-3 border-t border-border/60 pt-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={addable.length === 0}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Add tag
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-52 p-1">
                    <ul className="max-h-64 space-y-0.5 overflow-y-auto">
                      {addable.map(tag => (
                        <li key={tag}>
                          <button
                            type="button"
                            onClick={() => addTag(tag)}
                            className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-xs text-foreground transition-colors hover:bg-muted"
                          >
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{
                                backgroundColor: chartColorVar(
                                  resolveTagMeta(tag).chartIndex,
                                ),
                              }}
                            />
                            {tag}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </PopoverContent>
                </Popover>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={selectAll}
                  disabled={addable.length === 0}
                >
                  <CheckCheck className="mr-1 h-3.5 w-3.5" />
                  Select All
                </Button>

                {previewTags.length > 1 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={clearTags}
                    className="cursor-pointer gap-2 bg-red-200/10 text-red-700 hover:bg-red-200/20"
                  >
                    Clear <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
            {previewTags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {previewTags.map(tag => (
                  <div
                    key={tag}
                    className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs shadow-sm"
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{
                        backgroundColor: chartColorVar(
                          resolveTagMeta(tag).chartIndex,
                        ),
                      }}
                    />
                    <span className="font-mono">{tag}</span>
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      aria-label={`Remove ${tag}`}
                      className="ml-0.5 flex h-4 w-4 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-10 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
                No tags selected — add a tag to preview.
              </div>
            )}
          </div>
          <RawTrendChart
            rows={toChartRows(previewDataset)}
            tags={orderedTags}
            focusedTag={focus ? [focus] : []}
            range={range}
            hideTagSelector
          />
        </div>
      </div>
    </div>
  )
}
