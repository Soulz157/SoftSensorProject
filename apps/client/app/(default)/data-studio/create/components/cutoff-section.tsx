'use client'

import { useMemo, useState } from 'react'
import { Eye } from 'lucide-react'
import { toChartRows, type Dataset } from '@/lib/preprocessing'
import type {
  ConditionalRule,
  CropRange,
  PrecleanseRemoved,
  StatisticalRule,
  ValueCrop,
} from '@/lib/precleanse'
import type { TimeRange } from '@/lib/mock-readings'
import { SegmentedToggle } from '@/app/(default)/data-visualize/components/segmented-toggle'
import { RawTrendChart } from './chart/raw-data-chart'
import { DataCroppingChart } from './data-cropping-chart'
import { CutoffSidebar } from './cutoff-sidebar'

interface Props {
  raw: Dataset
  precleansed: Dataset
  range: TimeRange
  cropRange: CropRange
  onCropChange: (range: CropRange) => void
  valueCrop: ValueCrop
  onValueCropChange: (crop: ValueCrop) => void
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
}: Props) {
  const [preview, setPreview] = useState<Preview>('cleaned')
  const [isCutoffOpen, setIsCutoffOpen] = useState(true)

  const rawTimestamps = useMemo(() => raw.rows.map(r => r.timestamp), [raw])

  const afterDataset = stepPreviewDataset ?? precleansed
  const previewDataset = preview === 'raw' ? raw : afterDataset

  const chartRaw = scopeTag ? pickTag(raw, scopeTag) : raw
  const chartCleaned = scopeTag ? pickTag(precleansed, scopeTag) : precleansed
  const chartPreview = scopeTag
    ? pickTag(previewDataset, scopeTag)
    : previewDataset

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

          <RawTrendChart
            rows={toChartRows(chartPreview)}
            tags={chartPreview.tags}
            range={range}
            hideTagSelector
          />
        </div>
      </div>
    </div>
  )
}
