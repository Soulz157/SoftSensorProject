'use client'

import { useRouter } from 'next/navigation'
import { ArrowLeft, ChevronLeft, ChevronRight, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Step1Tags } from './step-1-tags'
import { Step2RawData } from './step-2-raw-data'
import { Step3Processing } from './step-3-processing'
import { Step4FillNull } from './step-4-fill-null'
import { Step5ReviewSave } from './step-5-review-save'
import { useDatasetPipelineNav } from '@/hooks/dataset/use-dataset-pipeline-nav'
import { WizardStepIndicator } from './wizard-step-indicator'

const STEP_LABELS = [
  'Verified Tags',
  'Fetch Data',
  'Preprocessing',
  'Fea',
  'Review & Save',
]

const NEXT_LABELS: Record<number, string> = {
  1: 'Continue',
  2: 'Continue',
  3: 'Data Cleaning',
  4: 'Feature Engineering',
}

export function WizardShell() {
  const router = useRouter()
  const nav = useDatasetPipelineNav()

  const hideFooterNext = nav.currentStep === 5

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
      body = <Step4FillNull nav={nav} />
      break
    case 5:
      body = <Step5ReviewSave nav={nav} />
      break
    default:
      body = null
  }
  const hideFooter = nav.currentStep === 3

  return (
    <div className="flex-1 overflow-auto bg-background p-6 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="space-y-1">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 gap-1.5 text-muted-foreground"
            onClick={() => router.push('/data-studio')}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Data Studio
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <Layers className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold text-foreground">
              Create Dataset
            </h1>
          </div>
          <p className="pl-8 text-sm text-muted-foreground">
            Select tags, fetch, clean, and fill missing values from your
            selected data sources.
          </p>
        </div>

        <div className="flex flex-col overflow-hidden rounded-xl ring-1 ring-foreground/10">
          <div className="flex items-center border-b border-border/60 bg-muted/30 px-6 py-3">
            <WizardStepIndicator
              labels={STEP_LABELS}
              currentStep={nav.currentStep}
              highestUnlocked={nav.highestUnlocked}
              onGoTo={nav.goTo}
            />
          </div>
          <div className="min-h-72 flex-1 bg-background p-6 lg:p-8">{body}</div>

          {!hideFooter && (
            <div className="flex items-center justify-between border-t border-border/60 bg-muted/30 px-4 py-3">
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
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
