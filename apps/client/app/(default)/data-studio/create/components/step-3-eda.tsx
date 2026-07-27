'use client'

import { Step31EDA } from './processing/step-3-1-EDA'
import { Step32Imputation } from './processing/step-3-2-imputation'
import { UseDatasetPipelineNavResult } from '@/hooks/dataset/use-dataset-pipeline-nav'

interface Props {
  nav: UseDatasetPipelineNavResult
}

export function Step3Processing({ nav }: Props) {
  const subStep = nav.processingSubStep

  return subStep === 1 ? (
    <Step31EDA nav={nav} />
  ) : (
    <Step32Imputation nav={nav} />
  )
}
