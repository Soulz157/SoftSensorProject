'use client'

import { useMemo } from 'react'
import { useAtomValue } from 'jotai'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { precleanse } from '@/lib/precleanse'
import {
  mpRawDatasetAtom,
  mpTimeRangeAtom,
  PERIOD_TO_RANGE,
} from '@/store/model-pipeline'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'
import { QualitySummaryCards } from './quality-summary-cards'
import { DataCroppingChart } from './data-cropping-chart'
import { OutlierRemovalPanel } from './outlier-removal-panel'
import { CorrelationHeatmap } from './correlation-heatmap'
import { ProcessingActionFooter } from './processing-action-footer'

interface Props {
  nav: UsePipelineNavResult
}

export function Step51Preprocessing({ nav }: Props) {
  const raw = useAtomValue(mpRawDatasetAtom)
  const period = useAtomValue(mpTimeRangeAtom)
  const range = PERIOD_TO_RANGE[period]

  const { cropRange, conditionalRules, statisticalRules } = nav

  const cropped = useMemo(
    () =>
      precleanse(raw, {
        crop: cropRange,
        conditional: [],
        statistical: [],
      }),
    [raw, cropRange],
  )

  const precleansed = useMemo(
    () =>
      precleanse(raw, {
        crop: cropRange,
        conditional: conditionalRules,
        statistical: statisticalRules,
      }),
    [raw, cropRange, conditionalRules, statisticalRules],
  )

  const emptied = raw.rows.length > 0 && precleansed.rows.length === 0

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Inspect data quality, crop the time range, and remove outliers before
        imputing missing values.
      </p>

      <QualitySummaryCards dataset={precleansed} />

      <DataCroppingChart
        rawDataset={raw}
        chartDataset={precleansed}
        range={range}
        cropRange={cropRange}
        onCropChange={nav.setCropRange}
      />

      <OutlierRemovalPanel
        tags={raw.tags}
        previewDataset={cropped}
        conditionalRules={conditionalRules}
        statisticalRules={statisticalRules}
        onConditionalChange={nav.setConditionalRules}
        onStatisticalChange={nav.setStatisticalRules}
      />

      {emptied && (
        <Alert variant="destructive">
          <AlertTitle>These rules removed every row</AlertTitle>
          <AlertDescription>
            Loosen a crop bound or an outlier rule to keep some data.
          </AlertDescription>
        </Alert>
      )}

      <CorrelationHeatmap dataset={precleansed} />

      <ProcessingActionFooter
        backLabel="Back"
        nextLabel="Data Imputation"
        onBack={nav.back}
        onNext={() => nav.setProcessingSubStep(2)}
        nextDisabled={precleansed.rows.length === 0}
      />
    </div>
  )
}
