'use client'

import { useMemo } from 'react'
import { useAtomValue } from 'jotai'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { precleanse, precleanseBounded } from '@/lib/precleanse'
import { describeAnalysisReadiness } from '@/lib/dataset-readiness'
import { PERIOD_TO_RANGE } from '@/store/model-pipeline'
import {
  dwBronzeWarmStateAtom,
  dwDraftArtifactIdAtom,
  dwEditingDatasetAtom,
  dwFeaturePreviewSampleAtom,
  dwFeaturePreviewSampleStateAtom,
  dwFetchRequiredAtom,
  dwRawDatasetAtom,
  dwTimeRangeAtom,
} from '@/store/dataset-studio'
import { useDatasetFeaturePreviewSample } from '@/hooks/dataset/use-dataset-feature-preview-sample'
import { useDatasetHoldoutResplit } from '@/hooks/dataset/use-dataset-holdout-resplit'
import { useDelayedFlag } from '@/hooks/use-delayed-flag'
import { DataAnalysisCard } from './data-analysis-card'
import { DataAnalysisCardSkeleton } from './data-analysis-card-skeleton'
import { ValidationHoldoutSection } from './validation-holdout-section'
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

  // DS-LAKE-015-T03: the windows between Step 2 finishing and this card
  // having anything real to draw. `fetchRequired` matters because a
  // CSV-only wizard never calls `useDatasetBronzeWarm` at all —
  // `dwBronzeWarmStateAtom` would sit at 'idle' forever for that path, which
  // must read as "not applicable", not "stuck preparing". Selection logic
  // lives in `describeAnalysisReadiness` (lib/) so it is unit-testable
  // without rendering `DataAnalysisCard`'s atom-heavy tree.
  const fetchRequired = useAtomValue(dwFetchRequiredAtom)
  const bronzeWarmState = useAtomValue(dwBronzeWarmStateAtom)
  const previewFetchState = useAtomValue(dwFeaturePreviewSampleStateAtom)
  const readiness = describeAnalysisReadiness({
    fetchRequired,
    bronzeWarmState,
    previewFetchState,
    sampleTagCount: sample.tags.length,
  })
  const isBusy =
    readiness.phase === 'preparing' || readiness.phase === 'loading'
  // Anti-flicker: only reveal the skeleton after it has been busy for a beat —
  // a sub-150ms resolution should never flash a skeleton at all.
  const showSkeleton = useDelayedFlag(isBusy, 150)

  // DS-LAKE-018-T06. Lifted here (not owned inside `ValidationHoldoutSection`)
  // because Next must stay disabled while a re-split is in flight — same
  // reasoning as gating Next on `isBusy` above: advancing mid-split would
  // take Step 3.2 to an artifact that is about to be replaced.
  const holdoutResplit = useDatasetHoldoutResplit()
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

      {isBusy && (
        <div role="status" aria-live="polite" aria-busy="true">
          <p aria-hidden="true" className="text-[11px] text-muted-foreground">
            {readiness.caption}
          </p>
          <span className="sr-only">{readiness.caption}</span>
          {showSkeleton && <DataAnalysisCardSkeleton />}
        </div>
      )}

      {readiness.phase === 'error' && (
        <Alert variant="destructive">
          <AlertTitle>Preview sample unavailable</AlertTitle>
          <AlertDescription>{readiness.caption}</AlertDescription>
        </Alert>
      )}

      {readiness.phase === 'empty' && (
        <p className="text-[11px] text-muted-foreground">{readiness.caption}</p>
      )}

      {readiness.phase === 'ready' && (
        <DataAnalysisCard dataset={precleansedSample} range={range} />
      )}

      {emptied && readiness.phase === 'ready' && (
        <Alert variant="destructive">
          <AlertTitle>These rules removed every row</AlertTitle>
          <AlertDescription>
            Loosen a crop bound or an outlier rule to keep some data.
          </AlertDescription>
        </Alert>
      )}

      <ValidationHoldoutSection
        disabled={isBusy || readiness.phase !== 'ready'}
        {...holdoutResplit}
      />

      <ProcessingActionFooter
        backLabel="Back"
        nextLabel="Data Cleaning"
        onBack={nav.back}
        onNext={() => nav.setProcessingSubStep(2)}
        nextDisabled={
          precleansed.rows.length === 0 ||
          isBusy ||
          holdoutResplit.status === 'pending'
        }
      />
    </div>
  )
}
