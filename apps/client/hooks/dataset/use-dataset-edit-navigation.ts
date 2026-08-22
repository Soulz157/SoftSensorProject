'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { initDatasetWizardForEditAtom } from '@/store/dataset-studio'
import type { SavedDataset } from '@/store/datasets'
import type { SavedDataSource } from '@/lib/mock-data-sources'

/**
 * Re-open a saved dataset in the Data Studio wizard to edit its preprocessing
 * pipeline: resolve the recipe's source ids to full source objects, hydrate
 * every `dw*` atom, and navigate. Extracted from `useDataStudio` so the model
 * wizard's Dataset Review step (MODEL-FLOW-010-T07) sends the user to the same
 * place by the same route rather than growing a second, drifting copy.
 *
 * This file is where the `@/store/dataset-studio` import LIVES for that
 * caller. The review step's own contract test (MODEL-FLOW-010-V02) forbids a
 * `dw*` import in any of its files — a wrong-store read there is silent empty
 * data, not a loud failure — so the indirection is load-bearing, not tidiness.
 *
 * `sources` is passed in rather than fetched here: `useDataSources` fetches
 * per instance (no shared cache), and both callers already have the list.
 */
export function useDatasetEditNavigation() {
  const router = useRouter()
  const initDatasetWizardForEdit = useSetAtom(initDatasetWizardForEditAtom)

  return useCallback(
    (dataset: SavedDataset, allSources: SavedDataSource[]) => {
      const sources = dataset.sourceIds
        .map(id => allSources.find(s => s.id === id))
        .filter((s): s is SavedDataSource => s !== undefined)

      // Legacy recipes (no `baseTags`) still open, but rebuild from the final
      // tag list rather than the original one — so the result can differ.
      if (!dataset.pipelineConfig.baseTags) {
        toast.warning(
          'Legacy dataset: original tags unavailable, recipe may differ',
        )
      }

      initDatasetWizardForEdit({ dataset, sources })
      router.push('/data-studio/create')
    },
    [initDatasetWizardForEdit, router],
  )
}
