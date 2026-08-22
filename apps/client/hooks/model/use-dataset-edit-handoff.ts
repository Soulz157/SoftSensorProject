'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { useModelDraftSync } from '@/hooks/model/use-model-draft-sync'
import { useDatasetEditNavigation } from '@/hooks/dataset/use-dataset-edit-navigation'
import type { SavedDataset } from '@/store/datasets'
import type { SavedDataSource } from '@/lib/mock-data-sources'

export interface UseDatasetEditHandoffResult {
  /** True while the draft is being written — the confirm button's busy state. */
  leaving: boolean
  /** Resolves true once the navigation was started, false if it was aborted. */
  handOff: (
    dataset: SavedDataset,
    sources: SavedDataSource[],
  ) => Promise<boolean>
}

/**
 * Leaving the model wizard to go and edit its dataset (MODEL-FLOW-010-T07).
 *
 * The ORDER is the feature: the draft is written to the server first, and a
 * failed write aborts the navigation rather than proceeding without it.
 * `useModelDraftSync`'s PATCH is 600ms-debounced, so a click landing inside
 * that window would otherwise strand the row on a configuration the user can
 * no longer see — and the dialog that precedes this promises the draft is
 * saved, so navigating anyway on a failed PATCH would make that a lie.
 *
 * `autoSync: false`: the Dataset Review step configures nothing and must not
 * PATCH on mount or on any control. This one write happens only after the
 * user confirms.
 *
 * Deliberately a hook rather than inline in the step: this is the only part
 * of the hand-off that can be got wrong in a way a test can catch, and the
 * step stays a composition shell.
 */
export function useDatasetEditHandoff(): UseDatasetEditHandoffResult {
  const { flush } = useModelDraftSync({ autoSync: false })
  const openDatasetForEdit = useDatasetEditNavigation()
  const [leaving, setLeaving] = useState(false)

  const handOff = useCallback(
    async (
      dataset: SavedDataset,
      sources: SavedDataSource[],
    ): Promise<boolean> => {
      setLeaving(true)
      try {
        await flush()
      } catch {
        toast.error(
          'Could not save your draft — staying here so nothing is lost. Try again.',
        )
        setLeaving(false)
        return false
      }
      openDatasetForEdit(dataset, sources)
      return true
    },
    [flush, openDatasetForEdit],
  )

  return { leaving, handOff }
}
