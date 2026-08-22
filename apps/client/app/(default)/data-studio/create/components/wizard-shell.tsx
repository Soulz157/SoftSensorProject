'use client'

import { useRouter } from 'next/navigation'
import { useAtomValue } from 'jotai'
import { ArrowLeft, ChevronLeft, ChevronRight, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Step1Tags } from './step-1-tags'
import { Step2RawData } from './step-2-raw-data'
import { Step3Processing } from './step-3-eda'
import { Step5ReviewSave } from './step-5-review-save'
import { useDatasetPipelineNav } from '@/hooks/dataset/use-dataset-pipeline-nav'
import { useDatasetEditHydration } from '@/hooks/dataset/use-dataset-edit-hydration'
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
    'Data Processing',
    'Feature Engineering',
    'Review & Save',
  ]
}

const NEXT_LABELS: Record<number, string> = {
  1: 'Continue',
  2: 'Continue',
  3: 'Data Cleaning',
  4: 'Continue',
}

export function WizardShell() {
  const router = useRouter()
  const nav = useDatasetPipelineNav()
  const fetchRequired = useAtomValue(dwFetchRequiredAtom)

  // Edit mode opens with no rows; this loads them from the committed artifact
  // (or materialises one). No-op in create mode, where the live fetch owns the
  // same atom.
  useDatasetEditHydration()
  // DS-LAKE-014-T04: keeps an ACTIVE draft's clock honest while this tab is
  // visibly open, across both create and edit mode and all five steps. No-op
  // until a draft id exists (dwDraftIdAtom starts null) and a no-op again
  // once the draft is SAVED/ABANDONED (the backend route itself filters).
  useDatasetDraftHeartbeat()
  const mode = useAtomValue(dwModeAtom)
  const rowSource = useAtomValue(dwRowSourceAtom)
  const syntheticReason = useAtomValue(dwSyntheticReasonAtom)
  const rowStage = useAtomValue(dwRowStageAtom)
  // Edit mode only, and only once real rows resolve: `currentArtifactId` is
  // stage-polymorphic (`SavedDataset.currentArtifactType`'s doc comment), so
  // a dataset saved past BRONZE (cleaned/feature-engineered/finalized)
  // hydrates already-processed rows here -- Step 3's crop/clean/impute would
  // then double-apply on top of them. Known limitation (DS-LAKE-013): the
  // fix here is surfacing the condition, not yet reading the true BRONZE
  // artifact.
  const showStageWarning =
    mode === 'edit' &&
    rowSource === 'stored' &&
    rowStage !== null &&
    rowStage !== 'BRONZE'

  const hideFooterNext = nav.currentStep === 5
  // ตรวจสอบว่าเป็น Step 1 หรือ 2 เพื่อจัด Layout ปุ่มไว้ด้านบน
  const isTopControlStep = nav.currentStep === 1 || nav.currentStep === 2
  // ซ่อน Footer ด้านล่างหากเป็น Step 1, 2 (เพราะย้ายไปไว้บนแล้ว) หรือ 3 (อาจจะซ่อนตาม Logic เดิม)
  const hideFooter = nav.currentStep === 3 || isTopControlStep

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
      body = <Step5ReviewSave nav={nav} />
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
              {nav.isEditLocked ? 'Edit Preprocessing' : 'Create Dataset'}
            </h1>
          </div>
          <p className="pl-8 text-sm text-muted-foreground">
            {nav.isEditLocked
              ? 'Raw query is locked — adjust only the preprocessing pipeline (cropping, cleaning, imputation). Tags, time range, and features cannot change.'
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
              <SyntheticDataBanner reason={syntheticReason} />
            )}
            {showStageWarning && (
              <SyntheticDataBanner
                reason=""
                title="These rows are already processed"
                message={`Hydrated from a ${rowStage} artifact, not the original raw fetch. Cropping, cleaning, and imputation here apply on top of that processing -- they do not replace it.`}
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
