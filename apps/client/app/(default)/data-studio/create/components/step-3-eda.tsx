'use client'

import { Step31EDA } from './processing/step-3-1-EDA'
import { UseDatasetPipelineNavResult } from '@/hooks/dataset/use-dataset-pipeline-nav'

interface Props {
  nav: UseDatasetPipelineNavResult
}

// DS-LAKE-022-T04..T07: Step 3 is EDA-only now — Data Cleaning (formerly
// sub-step 2) moved to its own Step 5, after Feature Engineering. The
// sub-step switch this component used to own died with that move.
export function Step3Processing({ nav }: Props) {
  return <Step31EDA nav={nav} />
}
