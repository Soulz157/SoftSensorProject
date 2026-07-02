'use client'

import { useAtomValue } from 'jotai'
import { mpProcessingSubStepAtom } from '@/store/model-pipeline'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'
import { Step51Preprocessing } from './processing/step-5-1-preprocessing'
import { Step52Imputation } from './processing/step-5-2-imputation'

interface Props {
  nav: UsePipelineNavResult
}

export function Phase5Processing({ nav }: Props) {
  const subStep = useAtomValue(mpProcessingSubStepAtom)

  return subStep === 1 ? (
    <Step51Preprocessing nav={nav} />
  ) : (
    <Step52Imputation nav={nav} />
  )
}
