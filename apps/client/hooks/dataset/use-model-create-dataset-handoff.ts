'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useSetAtom } from 'jotai'
import {
  initDatasetWizardAtom,
  type InitDatasetWizardSeed,
} from '@/store/dataset-studio'
import {
  rememberModelCreateHandoff,
  type ModelCreateHandoff,
} from '@/lib/model-create-handoff'

/**
 * MODEL-FLOW-032. Create Model Step 1 → Data Studio wizard → back to Step 1
 * with the new dataset selected.
 *
 * Seeds the wizard exactly the way Data Studio's own "Create Dataset" dialog
 * does (`useDataStudio.handleDatasetCreated`), so the dataset built from
 * here is indistinguishable from one built there. The only addition is the
 * remembered Step 1 form, written BEFORE the navigation so the wizard's Save
 * can find it.
 *
 * Lives in `hooks/dataset/` for the reason `use-retrain-dataset-handoff.ts`
 * does: the `dw*` store write belongs on this side of the boundary.
 */
export function useModelCreateDatasetHandoff() {
  const router = useRouter()
  const initDatasetWizard = useSetAtom(initDatasetWizardAtom)

  return useCallback(
    (stepOne: ModelCreateHandoff, seed: InitDatasetWizardSeed) => {
      rememberModelCreateHandoff(stepOne)
      initDatasetWizard(seed)
      router.push('/data-studio/create')
    },
    [initDatasetWizard, router],
  )
}
