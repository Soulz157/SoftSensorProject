'use client'

import { useEffect } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  dwEditingDatasetAtom,
  dwFetchStateAtom,
  dwModeAtom,
  dwRawDatasetAtom,
  dwRowSourceAtom,
  dwRowStageAtom,
  dwSyntheticCauseAtom,
  dwSyntheticReasonAtom,
} from '@/store/dataset-studio'
import { useDatasetVersionRows } from './use-dataset-version-rows'

/**
 * Bridge: fill the wizard's raw-dataset atom when a saved dataset is opened for
 * editing.
 *
 * Needed because `initDatasetWizardForEditAtom` is a jotai setter and cannot
 * await a fetch — it records WHICH dataset is being edited and leaves the rows
 * empty. This hook, mounted once by the wizard shell, does the async half.
 *
 * Create mode is untouched: rows there come from the live fetch in
 * `use-dataset-studio-fetch.ts`, and this stays disabled outside edit mode so
 * the two can never race for the same atom.
 */
export function useDatasetEditHydration(): { reload: () => void } {
  const mode = useAtomValue(dwModeAtom)
  const dataset = useAtomValue(dwEditingDatasetAtom)

  const setRawDataset = useSetAtom(dwRawDatasetAtom)
  const setFetchState = useSetAtom(dwFetchStateAtom)
  const setRowSource = useSetAtom(dwRowSourceAtom)
  const setRowStage = useSetAtom(dwRowStageAtom)
  const setSyntheticReason = useSetAtom(dwSyntheticReasonAtom)
  const setSyntheticCause = useSetAtom(dwSyntheticCauseAtom)

  const {
    dataset: rows,
    source,
    stage,
    status,
    loaded,
    total,
    syntheticReason,
    syntheticCause,
    reload,
  } = useDatasetVersionRows(dataset, { enabled: mode === 'edit' })

  useEffect(() => {
    if (mode !== 'edit' || !dataset) return

    if (status === 'loading' || status === 'materializing') {
      setFetchState({
        status: 'fetching',
        // Materialising has no row total until the artifact exists, so a
        // percentage would sit at 0 for the whole fetch. Only report one once
        // paging gives it a denominator.
        progress: total > 0 ? Math.round((loaded / total) * 100) : 0,
      })
      return
    }

    if (status === 'done' && rows) {
      setRawDataset(rows)
      setRowSource(source)
      setRowStage(stage)
      setSyntheticReason(syntheticReason)
      setSyntheticCause(syntheticCause)
      setFetchState({ status: 'done', progress: 100 })
    }
  }, [
    mode,
    dataset,
    rows,
    source,
    stage,
    status,
    loaded,
    total,
    syntheticReason,
    syntheticCause,
    setRawDataset,
    setFetchState,
    setRowSource,
    setRowStage,
    setSyntheticReason,
    setSyntheticCause,
  ])

  // DS-LAKE-025. Surfaced so the wizard shell's reclaimed-bytes banner can
  // re-run hydration after a successful re-fetch — `createRaw` repoints
  // `Dataset.currentArtifactId` at the new BRONZE, and without a re-read the
  // wizard would keep showing the stand-in rows it fell back to.
  return { reload }
}
