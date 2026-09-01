'use client'

import { useRouter } from 'next/navigation'
import { useAtomValue } from 'jotai'
import { ArrowLeft, ChevronLeft, ChevronRight, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Step1Tags } from './step-1-tags'
import { Step2RawData } from './step-2-raw-data'
import { Step3Processing } from './step-3-eda'
import { Step6ReviewSave } from './step-6-review-save'
import { Step5DataCleaning } from './step-5-data-cleaning'
import { useDatasetPipelineNav } from '@/hooks/dataset/use-dataset-pipeline-nav'
import { useDatasetEditHydration } from '@/hooks/dataset/use-dataset-edit-hydration'
import { useDatasetRowsRefetch } from '@/hooks/dataset/use-dataset-rows-refetch'
import { useDatasetDraftHeartbeat } from '@/hooks/dataset/use-dataset-draft-heartbeat'
import {
  dwFetchRequiredAtom,
  dwModeAtom,
  dwRowSourceAtom,
  dwRowStageAtom,
  dwSyntheticReasonAtom,
} from '@/store/dataset-studio'
import { SyntheticDataBanner } from '@/components/synthetic-data-banner'
import { WizardStepIndicator } from './wizard-step-indicator'
import { Step4FeatureEngineering } from './step-4-feature-engineering'

function stepLabels(fetchRequired: boolean): string[] {
  return [
    'Verified Tags',
    fetchRequired ? 'Fetch Data' : 'Source Validation',
    'EDA',
    'Feature Engineering',
    'Data Cleaning',
    'Review & Save',
  ]
}

const NEXT_LABELS: Record<number, string> = {
  1: 'Continue',
  2: 'Continue',
  3: 'Continue',
  4: 'Continue',
  5: 'Continue',
}

export function WizardShell() {
  const router = useRouter()
  const nav = useDatasetPipelineNav()
  const fetchRequired = useAtomValue(dwFetchRequiredAtom)

  // Edit mode opens with no rows; this loads them from the committed artifact
  // (or materialises one). No-op in create mode, where the live fetch owns the
  // same atom.
  const {
    reload: reloadEditRows,
    draftError,
    featureArtifactExpired,
    rawDataAbsent,
  } = useDatasetEditHydration()
  // DS-LAKE-025. The remedy for the one recoverable synthetic cause. Lives
  // here rather than on Step 6 because the banner it attaches to renders on
  // EVERY step — someone who notices the stand-in rows at Step 2 should be
  // able to fix it there, not only once Save has already refused.
  const rowsRefetch = useDatasetRowsRefetch(reloadEditRows)
  useDatasetDraftHeartbeat()
  const mode = useAtomValue(dwModeAtom)
  const rowSource = useAtomValue(dwRowSourceAtom)
  const syntheticReason = useAtomValue(dwSyntheticReasonAtom)
  const rowStage = useAtomValue(dwRowStageAtom)

  // artifact.
  const showStageWarning =
    mode === 'edit' &&
    rowSource === 'stored' &&
    rowStage !== null &&
    rowStage !== 'BRONZE'

  const hideFooterNext = nav.currentStep === 6
  const isTopControlStep = nav.currentStep === 1 || nav.currentStep === 2
  const hideFooter =
    nav.currentStep === 3 || nav.currentStep === 5 || isTopControlStep

  let body
  switch (nav.currentStep) {
    case 1:
      body = <Step1Tags nav={nav} />
      break
    case 2:
      body = <Step2RawData nav={nav} />
      break
    case 3:
      body = <Step3Processing nav={nav} />
      break
    case 4:
      body = <Step4FeatureEngineering nav={nav} />
      break
    case 5:
      body = <Step5DataCleaning nav={nav} />
      break
    case 6:
      body = <Step6ReviewSave nav={nav} />
      break
    default:
      body = null
  }

  const renderActionButtons = () => (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={nav.back}
        disabled={nav.currentStep === 1}
        className="gap-1"
      >
        <ChevronLeft className="h-4 w-4" />
        Back
      </Button>

      {!hideFooterNext && (
        <Button
          type="button"
          size="sm"
          onClick={nav.next}
          disabled={!nav.canAdvance(nav.currentStep)}
          className="gap-1"
        >
          {NEXT_LABELS[nav.currentStep] ?? 'Next'}
          <ChevronRight className="h-4 w-4" />
        </Button>
      )}
    </>
  )

  return (
    <div className="flex-1 overflow-auto bg-background p-6 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="space-y-1">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 gap-1.5 text-muted-foreground"
            onClick={() => router.push('/datasets')}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Datasets
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <Layers className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold text-foreground">
              {nav.isEditLocked ? 'Edit Dataset' : 'Create Dataset'}
            </h1>
          </div>
          <p className="pl-8 text-sm text-muted-foreground">
            {nav.isEditLocked
              ? // DS-LAKE-024-T07: was "...Tags, time range, and features
                // cannot change" — wrong since T02 let edit mode add
                // features from the dataset's existing tags. Restated to
                // name the ACTUAL locked surface (the raw tag set / fetch
                // window), not "features" generally.
                'Raw query is locked — adjust the preprocessing pipeline (cropping, cleaning, imputation) and add features from the tags already fetched. The tag set and time range cannot change.'
              : 'Select tags, fetch, clean, and fill missing values from your selected data sources.'}
          </p>
        </div>

        <div className="flex flex-col overflow-hidden rounded-xl ring-1 ring-foreground/10 relative">
          <div className="flex flex-col sticky top-0 z-10 bg-muted/95 backdrop-blur-md">
            {isTopControlStep && (
              <div className="flex items-center justify-between border-b border-border/60 px-6 py-3">
                {renderActionButtons()}
              </div>
            )}

            <div className="flex items-center border-b border-border/60 px-6 py-3">
              <WizardStepIndicator
                labels={stepLabels(fetchRequired || nav.isEditLocked)}
                currentStep={nav.currentStep}
                highestUnlocked={nav.highestUnlocked}
                onGoTo={nav.goTo}
              />
            </div>
          </div>

          <div className="min-h-72 flex-1 space-y-4 bg-background p-6 lg:p-8">
            {/* Above the step content, on EVERY step: the rows feed the charts,
                statistics and cleaning previews throughout, so the disclosure
                cannot live on one screen the user might skip past. */}
            {rowSource === 'synthetic' && syntheticReason && (
              <SyntheticDataBanner
                reason={syntheticReason}
                action={
                  rowsRefetch.available
                    ? {
                        label: 'Re-fetch from source',
                        pendingLabel: 'Re-fetching…',
                        pending: rowsRefetch.pending,
                        onClick: rowsRefetch.refetch,
                      }
                    : undefined
                }
              />
            )}
            {/* DS-LAKE-024-T08 (openDecisions[3]). Says outright that this
                dataset has no raw data, instead of leaving it to be inferred
                from an empty table plus a draft error that used to blame
                reclaimed bytes for rows that never existed. Rendered ABOVE
                the draft-error banner and suppressing it (below), because
                when both fire they are two statements of one fact and this
                is the accurate one. */}
            {rawDataAbsent && (
              <SyntheticDataBanner
                reason=""
                title={
                  rawDataAbsent.materializing
                    ? 'No raw data stored yet — fetching it now'
                    : 'This dataset has no raw data'
                }
                message={
                  rawDataAbsent.materializing
                    ? 'This dataset was saved without its rows. They are being ' +
                      'fetched from the source now — editing becomes available ' +
                      'once they arrive.'
                    : `This dataset has no rows stored, and they cannot be fetched automatically: ${
                        rawDataAbsent.reason ??
                        'its saved recipe does not describe a re-readable source.'
                      } Until it has raw data, editing cannot produce a new version.`
                }
              />
            )}
            {mode === 'edit' && draftError && !rawDataAbsent && (
              <SyntheticDataBanner
                reason=""
                title="Couldn't prepare this dataset for editing"
                message={draftError}
              />
            )}
            {/* DS-LAKE-027. Informational, not a failure: the draft was
                already repaired server-side and editing works normally from
                here. Says why the previous session's feature result is gone,
                so Step 4 recomputing it does not read as work silently
                undone. Suppressed alongside the two banners above, which
                describe genuinely blocking states. */}
            {mode === 'edit' &&
              featureArtifactExpired &&
              !rawDataAbsent &&
              !draftError && (
                <SyntheticDataBanner
                  reason=""
                  title="Previous feature engineering result expired"
                  message={
                    'This dataset had been left open for a while, so its ' +
                    'intermediate feature-engineering data was cleaned up. ' +
                    'Editing has resumed from the raw artifact — the result ' +
                    'is recomputed automatically when you reach Feature ' +
                    'Engineering. Nothing saved was lost.'
                  }
                />
              )}
            {showStageWarning && (
              <SyntheticDataBanner
                reason=""
                title="Editing re-runs from the original raw fetch"
                message={`These rows are shown from a ${rowStage} artifact for reference. Cropping and cleaning here re-run from the original raw fetch and replace that prior processing -- they do not build on top of it.`}
              />
            )}
            {body}
          </div>

          {!hideFooter && (
            <div className="flex items-center justify-between border-t border-border/60 bg-muted/30 px-6 py-3">
              {renderActionButtons()}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
