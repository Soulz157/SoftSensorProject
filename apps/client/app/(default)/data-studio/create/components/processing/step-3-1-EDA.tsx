'use client'

import { useMemo } from 'react'
import { useAtomValue } from 'jotai'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { precleanse, precleanseBounded } from '@/lib/precleanse'
import { PERIOD_TO_RANGE } from '@/store/model-pipeline'
import {
  dwFeaturePreviewSampleAtom,
  dwRawDatasetAtom,
  dwTimeRangeAtom,
} from '@/store/dataset-studio'
import { useDatasetFeaturePreviewSample } from '@/hooks/dataset/use-dataset-feature-preview-sample'
import { DataAnalysisCard } from './data-analysis-card'
import { ProcessingActionFooter } from './processing-action-footer'
import { UseDatasetPipelineNavResult } from '@/hooks/dataset/use-dataset-pipeline-nav'

interface Props {
  nav: UseDatasetPipelineNavResult
}

export function Step31EDA({ nav }: Props) {
  const raw = useAtomValue(dwRawDatasetAtom)
  const period = useAtomValue(dwTimeRangeAtom)
  const range = PERIOD_TO_RANGE[period]

  const { cropRange, conditionalRules, statisticalRules } = nav

  // DS-LAKE-005B-D-T07. Same bounded page `Step4FeatureEngineering` warms
  // via this hook (`dwDraftArtifactIdAtom` — the draft's SILVER source
  // artifact — is identical at both steps; `DataAnalysisCard`'s own
  // GOLD-if-present-else-draft comment already documents that Step 3.1
  // always resolves to `draftArtifactId`). Calling it here too just warms
  // the shared atom earlier, before Step 4 ever mounts.
  useDatasetFeaturePreviewSample()
  const sample = useAtomValue(dwFeaturePreviewSampleAtom)

  const precleansed = useMemo(
    () =>
      precleanse(raw, {
        crop: cropRange,
        conditional: conditionalRules,
        statistical: statisticalRules,
      }),
    [raw, cropRange, conditionalRules, statisticalRules],
  )

  // BOUNDED counterpart, for `DataAnalysisCard` only — `precleansed` above
  // (full frame) stays the source of truth for `emptied`/`nextDisabled`
  // below, which need the TRUE row count: a rule could empty the first N
  // rows of `sample` while thousands of real rows survive elsewhere in the
  // artifact, so gating navigation on the bounded result would be wrong.
  const precleansedSample = useMemo(
    () =>
      precleanseBounded(sample, {
        crop: cropRange,
        conditional: conditionalRules,
        statistical: statisticalRules,
      }),
    [sample, cropRange, conditionalRules, statisticalRules],
  )

  const emptied = raw.rows.length > 0 && precleansed.rows.length === 0

  return (
    <div className="space-y-4">
      <h3>Step 3.1: Exploratory Data Analysis (EDA)</h3>
      <p className="text-sm text-muted-foreground">
        Inspect data quality, crop the time range, and remove outliers before
        imputing missing values.
      </p>

      <DataAnalysisCard dataset={precleansedSample} range={range} />

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
