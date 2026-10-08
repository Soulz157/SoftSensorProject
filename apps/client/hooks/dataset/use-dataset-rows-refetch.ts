'use client'

import { useCallback, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { datasetVersionService } from '@/services/dataset-version'
import { toPiTime } from '@/lib/dataset-fetch'
import { materializeBlocker } from './use-dataset-version-rows'
import {
  dwEditingDatasetAtom,
  dwFetchStateAtom,
  dwSyntheticCauseAtom,
} from '@/store/dataset-studio'

/**
 * DS-LAKE-025. Re-read a saved dataset's rows from its source, for the one
 * synthetic cause that is recoverable in place.
 *
 * When a dataset's committed object has been reclaimed, hydration falls back
 * to generated rows and Step 6 refuses to save — saving would overwrite the
 * dataset's real tag list and row count with figures derived from a seed.
 * That leaves exactly one way forward, and this is it: mint a fresh BRONZE
 * artifact from the recipe the dataset already carries.
 *
 * Deliberately reuses `datasetVersionService.createRaw` — the same call
 * `useDatasetVersionRows` makes on its own materialise branch, and the same
 * one Step 6 makes after a create-save. `createRawArtifactService` repoints
 * `Dataset.currentArtifactId` at the new artifact
 * (`dataset-version.authorized.service.ts:509`), so re-running hydration
 * afterwards reads real rows instead of following the dead pointer.
 *
 * Screened by `materializeBlocker` first, for the reason that helper already
 * documents: a CSV's rows only ever existed in the browser, and a
 * multi-source or SQL recipe cannot be re-fetched by this endpoint. Those
 * datasets cannot be recovered this way and are told so, rather than being
 * sent into a request that would fail.
 */
export function useDatasetRowsRefetch(onDone: () => void) {
  const dataset = useAtomValue(dwEditingDatasetAtom)
  const cause = useAtomValue(dwSyntheticCauseAtom)
  const setFetchState = useSetAtom(dwFetchStateAtom)
  const [pending, setPending] = useState(false)

  const refetch = useCallback(() => {
    if (!dataset || pending) return

    const config = dataset.pipelineConfig
    const blocker = materializeBlocker(config)
    if (blocker) {
      toast.error(`Cannot re-fetch these rows: ${blocker}`)
      return
    }

    setPending(true)
    setFetchState({ status: 'fetching', progress: 0 })
    datasetVersionService
      .createRaw(dataset.id, {
        sourceId: Object.keys(config.sourceFetchConfigs)[0]!,
        tags: config.baseTags!,
        startTime: toPiTime(config.customDateRange!.from),
        endTime: toPiTime(config.customDateRange!.to),
      })
      .then(() => {
        toast.success('Rows re-fetched from the source')
        // Re-runs hydration against the repointed artifact, which clears the
        // synthetic cause and unblocks Save.
        onDone()
      })
      .catch((err: unknown) => {
        setFetchState({ status: 'done', progress: 100 })
        toast.error(
          err instanceof Error
            ? `Could not re-fetch the rows: ${err.message}`
            : 'Could not re-fetch the rows from the source.',
        )
      })
      .finally(() => setPending(false))
  }, [dataset, pending, setFetchState, onDone])

  return {
    /** Only the reclaimed-bytes case is recoverable this way. */
    available: cause === 'bytes-missing' && Boolean(dataset),
    pending,
    refetch,
  }
}
