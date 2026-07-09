'use client'

import { useState } from 'react'
import { Eye } from 'lucide-react'
import { toChartRows, type Dataset } from '@/lib/preprocessing'
import type {
  ConditionalRule,
  CropRange,
  StatisticalRule,
} from '@/lib/precleanse'
import type { TimeRange } from '@/lib/mock-readings'
import { SegmentedToggle } from '@/app/(default)/data-visualize/components/segmented-toggle'
import { RawTrendChart } from './chart/raw-data-chart'
import { DataCroppingChart } from './data-cropping-chart'
import { OutlierRemovalPanel } from './outlier-removal-panel'

interface Props {
  raw: Dataset
  precleansed: Dataset
  /** Cropped-only dataset (pre-outlier) — basis for the outlier panel's live preview. */
  cropped: Dataset
  range: TimeRange
  cropRange: CropRange
  onCropChange: (range: CropRange) => void
  tags: string[]
  conditionalRules: ConditionalRule[]
  statisticalRules: StatisticalRule[]
  onConditionalChange: (rules: ConditionalRule[]) => void
  onStatisticalChange: (rules: StatisticalRule[]) => void
}

type Preview = 'raw' | 'cleaned'

/**
 * Cut-off controls (time range + logical conditions) with a local
 * Before/After preview. The preview is local to this section only — it does
 * NOT affect RawTrendSection/StatisticalAnalysisSection, which always show
 * the current live `precleansed` state.
 */
export function CutOffSection({
  raw,
  precleansed,
  cropped,
  range,
  cropRange,
  onCropChange,
  tags,
  conditionalRules,
  statisticalRules,
  onConditionalChange,
  onStatisticalChange,
}: Props) {
  const [preview, setPreview] = useState<Preview>('cleaned')
  const previewDataset = preview === 'raw' ? raw : precleansed

  return (
    <div className="space-y-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <h2 className="text-sm font-medium text-foreground">
        Data Cut-Off &amp; Cleansing
      </h2>

      <DataCroppingChart
        rawDataset={raw}
        chartDataset={precleansed}
        range={range}
        cropRange={cropRange}
        onCropChange={onCropChange}
      />

      <OutlierRemovalPanel
        tags={tags}
        previewDataset={cropped}
        conditionalRules={conditionalRules}
        statisticalRules={statisticalRules}
        onConditionalChange={onConditionalChange}
        onStatisticalChange={onStatisticalChange}
      />

      <div className="flex items-center justify-between border-t border-border/60 pt-4">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Eye className="h-3.5 w-3.5" />
          Preview result
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
        rows={toChartRows(previewDataset)}
        tags={previewDataset.tags}
        range={range}
        hideTagSelector
      />
    </div>
  )
}
