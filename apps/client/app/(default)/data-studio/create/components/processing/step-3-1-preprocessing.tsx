'use client'

import { useMemo } from 'react'
import { useAtomValue } from 'jotai'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { precleanse } from '@/lib/precleanse'
import { PERIOD_TO_RANGE } from '@/store/model-pipeline'
import { dwRawDatasetAtom, dwTimeRangeAtom } from '@/store/dataset-studio'
import { RawTrendSection } from '../raw-trend-section'
import { StatisticalAnalysisSection } from '../statistical-analysis-section'
import { ProcessingActionFooter } from './processing-action-footer'
import { UseDatasetPipelineNavResult } from '@/hooks/dataset/use-dataset-pipeline-nav'

interface Props {
  nav: UseDatasetPipelineNavResult
}

export function Step31Preprocessing({ nav }: Props) {
  const raw = useAtomValue(dwRawDatasetAtom)
  const period = useAtomValue(dwTimeRangeAtom)
  const range = PERIOD_TO_RANGE[period]

  const { cropRange, conditionalRules, statisticalRules } = nav

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
      <h3>Step 3.1: Data Preprocessing</h3>
      <p className="text-sm text-muted-foreground">
        Inspect data quality, crop the time range, and remove outliers before
        imputing missing values.
      </p>

      <RawTrendSection dataset={precleansed} range={range} />

      <StatisticalAnalysisSection dataset={precleansed} />

      {emptied && (
        <Alert variant="destructive">
          <AlertTitle>These rules removed every row</AlertTitle>
          <AlertDescription>
            Loosen a crop bound or an outlier rule to keep some data.
          </AlertDescription>
        </Alert>
      )}

      <ProcessingActionFooter
        backLabel="Back"
        nextLabel="Data Cleaning"
        onBack={nav.back}
        onNext={() => nav.setProcessingSubStep(2)}
        nextDisabled={precleansed.rows.length === 0}
      />
    </div>
  )
}
