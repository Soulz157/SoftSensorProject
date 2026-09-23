'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { initDatasetWizardFromBaseRecipeAtom } from '@/store/dataset-studio'
import { rememberRetrainHandoff } from '@/lib/retrain-handoff'
import type { SavedDataset } from '@/store/datasets'
import type { SavedDataSource } from '@/lib/mock-data-sources'

/**
 * MODEL-SERVE-017. Sends the operator from the retrain dialog into the Data
 * Studio wizard to build the NEW dataset a retrain will train on — inheriting
 * the base dataset's recipe, over a different time range.
 *
 * Why a handoff rather than building the dataset inside the dialog: the
 * operator asked to clean and feature-engineer the new data, and the wizard
 * already IS that — Step 3 EDA, Step 4 Feature Engineering, Step 5 Data
 * Cleaning, Step 6 Save. Re-running that chain headlessly would duplicate the
 * wizard's pipeline (and its job polling) while offering no editing at all.
 *
 * This lives in `hooks/dataset/` for the same load-bearing reason
 * `use-dataset-edit-navigation.ts` does: the `dw*` store import belongs on
 * this side of the boundary. A model-side file reading the wrong store gets
 * silently empty data rather than a loud failure.
 *
 * It is NOT `useDatasetEditNavigation`: that re-opens a dataset in EDIT mode,
 * where Save writes a new version of that same dataset. Here Save must mint a
 * SEPARATE dataset — a new version of the base would repoint the base's
 * `currentVersionId` at a slice holding only the new range.
 */
export function useRetrainDatasetHandoff() {
  const router = useRouter()
  const initFromBaseRecipe = useSetAtom(initDatasetWizardFromBaseRecipeAtom)

  return useCallback(
    (
      baseDataset: SavedDataset,
      allSources: SavedDataSource[],
      /**
       * The incumbent's split boundary, carried through so Step 2's From
       * picker can clamp to it. The window itself is chosen there — asking
       * for it here too meant picking a date range twice.
       */
      cutTimestamp: string | null,
      /**
       * What to restore when the operator comes back. Omitted, the wizard
       * still works — it simply returns to Data Studio as it always has.
       */
      returning?: {
        modelId: string
        strategy: 'AUGMENT_DATA' | 'NEW_DATA_ONLY'
      },
    ) => {
      const sources = baseDataset.sourceIds
        .map(id => allSources.find(s => s.id === id))
        .filter((s): s is SavedDataSource => s !== undefined)

      if (sources.length === 0) {
        toast.error(
          'The base dataset’s data source is unavailable, so a new range ' +
            'cannot be fetched for it.',
        )
        return
      }

      // Legacy recipes (no `baseTags`) still open, but the wizard rebuilds
      // from the final tag list rather than the original source tags — so the
      // result can differ from the base, and a differing tag set is exactly
      // what `assertCompatible` refuses at retrain time. Same warning, same
      // reason, as the edit handoff.
      if (!baseDataset.pipelineConfig?.baseTags) {
        toast.warning(
          'Legacy dataset: original tags unavailable, the new dataset’s ' +
            'recipe may differ from the current version’s',
        )
      }

      // Remembered BEFORE the navigation, so the wizard's own Save can find
      // it. Written last among the guards: an early return above means the
      // operator never left, and a stale intent would then redirect an
      // unrelated later save back to this model.
      if (returning) {
        rememberRetrainHandoff({
          modelId: returning.modelId,
          strategy: returning.strategy,
          returnTo: `/models/${returning.modelId}`,
        })
      }

      initFromBaseRecipe({
        dataset: baseDataset,
        sources,
        // The range is not known yet — it is chosen at Step 2 — so the name
        // cannot embed it. Step 6's name field is editable and required
        // before Save, which is where a date-bearing name gets written if
        // the operator wants one.
        name: `${baseDataset.name} — new data`,
        cutTimestamp,
      })
      router.push('/data-studio/create')
    },
    [initFromBaseRecipe, router],
  )
}
