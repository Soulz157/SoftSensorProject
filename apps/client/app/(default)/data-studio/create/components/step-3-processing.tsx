'use client'

import { Step31Preprocessing } from './processing/step-3-1-preprocessing'
import { Step32Imputation } from './processing/step-3-2-imputation'
import { UseDatasetPipelineNavResult } from '@/hooks/dataset/use-dataset-pipeline-nav'

interface Props {
  nav: UseDatasetPipelineNavResult
}

export function Step3Processing({ nav }: Props) {
  const subStep = nav.processingSubStep

  return subStep === 1 ? (
    <Step31Preprocessing nav={nav} />
  ) : (
    <Step32Imputation nav={nav} />
  )
}
