'use client'

import { useWizardNavigation } from '@/hooks/use-wizard-navigation'
import { WizardStepIndicator } from './wizard-step-indicator'
import { StickyActionBar } from './sticky-action-bar'
import { Step1WorkspacePlant } from './step-1-workspace-plant'
import { Step2PiServer } from './step-2-pi-server'
import { Step3TagRange } from './step-3-tag-range'
import { Step4Fetching } from './step-4-fetching'
import { Step5RawData } from './step-5-raw-data'
import { Step6Processing } from './step-6-processing'
import { Step7Export } from './step-7-export'

const NEXT_LABEL: Record<number, string> = {
  1: 'Continue',
  2: 'Continue',
  3: 'Fetch data',
  4: 'Continue',
  5: 'Continue',
  6: 'Continue',
  7: 'Done',
}

export function WizardShell() {
  const nav = useWizardNavigation()

  let stepContent
  switch (nav.currentStep) {
    case 1:
      stepContent = <Step1WorkspacePlant nav={nav} />
      break
    case 2:
      stepContent = <Step2PiServer />
      break
    case 3:
      stepContent = <Step3TagRange nav={nav} />
      break
    case 4:
      stepContent = <Step4Fetching nav={nav} />
      break
    case 5:
      stepContent = <Step5RawData />
      break
    case 6:
      stepContent = <Step6Processing />
      break
    case 7:
      stepContent = <Step7Export />
      break
    default:
      stepContent = null
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <WizardStepIndicator nav={nav} />
      <div className="flex-1">{stepContent}</div>
      {nav.currentStep < 7 && (
        <StickyActionBar
          onNext={nav.next}
          onBack={nav.back}
          backDisabled={nav.currentStep === 1}
          nextDisabled={!nav.canAdvance(nav.currentStep)}
          nextLabel={NEXT_LABEL[nav.currentStep] ?? 'Continue'}
        />
      )}
    </div>
  )
}
