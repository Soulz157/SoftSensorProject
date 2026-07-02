'use client'

import { ArrowLeft, ChevronLeft, ChevronRight, Cpu, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCreateModel } from '@/hooks/model/use-create-model'
import { useModelPipelineNav } from '@/hooks/model/use-model-pipeline-nav'
import { useModelWizardMode } from '@/hooks/model/use-model-wizard-mode'
import { WizardStepIndicator } from './wizard-step-indicator'
import { Phase1Details } from './pipeline/phase-1-details'
import { Phase2DataSource } from './pipeline/phase-2-data-source'
import { Phase3TagSelection } from './pipeline/phase-3-tag-selection'
import { Phase4RawData } from './pipeline/phase-4-raw-data'
import { Phase5Processing } from './pipeline/phase-5-processing'
import { Phase6Training } from './pipeline/phase-6-training'
import { Phase7Results } from './pipeline/phase-7-results'

const NEXT_LABELS: Record<number, string> = {
  1: 'Continue',
  2: 'Continue',
  3: 'Confirm Tags',
  4: 'Next',
  5: 'Next',
  6: 'Start Training Model',
  7: 'View Results',
}

export function CreateModelForm() {
  const {
    form,
    setName,
    setDescription,
    changeWorkspace,
    changePlant,
    setNodeId,
    plants,
    nodes,
    plantsLoading,
    cancel,
  } = useCreateModel()
  const nav = useModelPipelineNav()
  const { mode, modelName } = useModelWizardMode()
  const isEdit = mode === 'edit'

  const step3Label =
    nav.tagInputMethod === 'direct' ? 'Verified Tags' : 'Compare & Map'
  const STEP_LABELS = [
    'Details',
    'Data Source',
    step3Label,
    'Raw Data',
    'Processing',
    'Training',
    'Results',
  ]

  // Training (6) auto-advances; Results (7) is terminal with its own actions.
  const hideFooterNext = nav.currentStep === 6 || nav.currentStep === 7
  // Processing (5) is a two-sub-step flow that owns its own Back/Next footer.
  const hideFooter = nav.currentStep === 5
  const nextLabel =
    isEdit && nav.currentStep === 6
      ? 'Save & Train'
      : (NEXT_LABELS[nav.currentStep] ?? 'Next')

  let body
  switch (nav.currentStep) {
    case 1:
      body = (
        <Phase1Details
          mode={mode}
          name={form.name}
          description={form.description}
          workspaceId={form.workspaceId}
          plantId={form.plantId}
          nodeId={form.nodeId}
          plants={plants}
          nodes={nodes}
          plantsLoading={plantsLoading}
          onName={setName}
          onDescription={setDescription}
          onWorkspace={changeWorkspace}
          onPlant={changePlant}
          onNode={setNodeId}
        />
      )
      break
    case 2:
      body = <Phase2DataSource nav={nav} />
      break
    case 3:
      body = <Phase3TagSelection nav={nav} />
      break
    case 4:
      body = <Phase4RawData nav={nav} />
      break
    case 5:
      body = <Phase5Processing nav={nav} />
      break
    case 6:
      body = <Phase6Training nav={nav} />
      break
    case 7:
      body = <Phase7Results nav={nav} />
      break
    default:
      body = null
  }

  return (
    <div className="flex-1 overflow-auto bg-background p-6 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <div className="space-y-1">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 gap-1.5 text-muted-foreground"
            onClick={cancel}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to models
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            {isEdit ? (
              <Pencil className="h-6 w-6 text-amber-500" />
            ) : (
              <Cpu className="h-6 w-6 text-primary" />
            )}
            <h1 className="text-2xl font-semibold text-foreground">
              {isEdit ? `Edit Model: ${modelName}` : 'Create Model'}
            </h1>
            {isEdit && (
              <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-600 ring-1 ring-amber-500/30 dark:text-amber-400">
                Editing
              </span>
            )}
          </div>
          <p className="pl-8 text-sm text-muted-foreground">
            {isEdit
              ? 'Update this model’s configuration, then save your changes.'
              : 'Configure, fetch, clean, and train your predictive model.'}
          </p>
        </div>

        {/* Wizard */}
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
                  {nextLabel}
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
