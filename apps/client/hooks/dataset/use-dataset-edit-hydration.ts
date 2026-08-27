'use client'

import { useEffect, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { datasetDraftService } from '@/services/dataset-draft'
import {
  dwDraftArtifactIdAtom,
  dwDraftIdAtom,
  dwEditingDatasetAtom,
  dwEditingDatasetIdAtom,
  dwEditRootValidationRowCountAtom,
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
 * Bridge: fill the wizard's raw-dataset atom, and resolve the wizard's own
 * server-side draft, when a saved dataset is opened for editing.
 *
 * Needed because `initDatasetWizardForEditAtom` is a jotai setter and cannot
 * await a fetch — it records WHICH dataset is being edited and leaves the
 * rows empty and `dwDraftIdAtom`/`dwDraftArtifactIdAtom` null (deliberately,
 * per that atom's own doc comment — a stale draft id from a prior create
 * session must not leak into a fresh edit one). This hook, mounted once by
 * the wizard shell, does both halves.
 *
 * DS-LAKE-024-T03. The draft half matters beyond hydration: every
 * draft-scoped hook (`useDatasetGoldWarm`, `useDatasetHoldoutResplit`,
 * `useDatasetDraftPipeline`, the chart tabs, `useDatasetFeaturePreviewSample`)
 * reads `dwDraftIdAtom` directly, and `useDatasetDraftPipeline`'s own
 * `ensureDraft` falls back to MINTING A CREATE-MODE DRAFT whenever that atom
 * is still null — which would silently re-fetch live source data for a
 * dataset the user is editing historically. Resolving (or creating) the
 * edit draft here, as early as the wizard mounts, is what keeps that
 * fallback unreachable in practice; `ensureDraft` itself refuses outright in
 * edit mode as the hard backstop (see its own doc comment).
 *
 * Never re-materializes: `resolveOrCreateForDataset` seeds the draft from
 * the dataset's already-adopted, lineage-pinned BRONZE.
 *
 * Create mode is untouched: rows there come from the live fetch in
 * `use-dataset-studio-fetch.ts`, and this stays disabled outside edit mode so
 * the two can never race for the same atom.
 */
/**
 * DS-LAKE-024-T08. Non-null when the dataset being edited has no stored raw
 * artifact — the state `openDecisions[3]` left undecided, now stated rather
 * than discovered.
 *
 * `materializing: true` is the transient half: the rows path
 * (`useDatasetVersionRows` branch 2) is fetching V1 from the saved recipe
 * right now, and once it lands the draft resolves on its own. `false` is the
 * terminal half: there is no raw data and the recipe cannot produce any
 * automatically (`reason` carries `materializeBlocker`'s own wording — a
 * CSV whose rows only ever existed in the browser, a multi-source recipe, or
 * one saved before its tag list/time range was recorded).
 */
export interface EditRawDataAbsent {
  materializing: boolean
  reason: string | null
}

export function useDatasetEditHydration(): {
  reload: () => void
  draftError: string | null
  rawDataAbsent: EditRawDataAbsent | null
} {
  const mode = useAtomValue(dwModeAtom)
  const dataset = useAtomValue(dwEditingDatasetAtom)
  const editingDatasetId = useAtomValue(dwEditingDatasetIdAtom)
  const draftId = useAtomValue(dwDraftIdAtom)

  const setRawDataset = useSetAtom(dwRawDatasetAtom)
  const setFetchState = useSetAtom(dwFetchStateAtom)
  const setRowSource = useSetAtom(dwRowSourceAtom)
  const setRowStage = useSetAtom(dwRowStageAtom)
  const setSyntheticReason = useSetAtom(dwSyntheticReasonAtom)
  const setSyntheticCause = useSetAtom(dwSyntheticCauseAtom)
  const setDraftId = useSetAtom(dwDraftIdAtom)
  const setDraftArtifactId = useSetAtom(dwDraftArtifactIdAtom)
  const setEditRootValidationRowCount = useSetAtom(
    dwEditRootValidationRowCountAtom,
  )
  const [draftError, setDraftError] = useState<string | null>(null)

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

  // DS-LAKE-024-T08 (openDecisions[3]). True once the rows path has settled
  // on REAL rows — i.e. an artifact now exists server-side, either because
  // one already did or because branch 2 just materialized V1. Synthetic
  // rows deliberately do NOT count: nothing was created, so a retry would
  // fail identically.
  //
  // This is the retry trigger for the draft effect below, and it has to be
  // this rather than `dataset.currentArtifactId`: `dwEditingDatasetAtom`
  // holds the dataset as fetched at wizard open and is never re-read after
  // `createRaw` repoints that column server-side, so a retry keyed on it
  // would never fire.
  const rowsSettledOnRealArtifact = status === 'done' && syntheticCause === null

  // DS-LAKE-024-T03. Fires once per edit session, independent of the rows
  // effect above (rows can still be loading/synthetic while this resolves).
  // Bails as soon as `draftId` is set — either by this effect's own
  // success, or (idempotently) by a second mount finding an already-ACTIVE
  // draft server-side; either way there is nothing left to resolve.
  //
  // DS-LAKE-024-T08: `rowsSettledOnRealArtifact` is a dependency, not a
  // guard — the first attempt still fires immediately at mount, so a
  // dataset that already HAS a BRONZE arms its draft-scoped hooks without
  // waiting for row paging to finish. It exists for the dataset that has
  // none: that first attempt 422s, and without a retry `draftId` stayed
  // null for the whole session even after branch 2 finished materializing
  // one — which silently dropped edit-mode Save onto the legacy
  // metadata-only path (`step-6-review-save.tsx`'s `else` branch), writing
  // no version and no artifact. That is the exact defect this feature
  // exists to remove, so it must not survive in the one case that starts
  // without a root. On the already-has-a-BRONZE path this re-run is a
  // no-op: `draftId` is set by then and the guard returns first.
  useEffect(() => {
    if (mode !== 'edit' || !editingDatasetId || draftId) return
    let cancelled = false
    // Cleared on RESOLUTION, not synchronously here (react-hooks/
    // set-state-in-effect): a synchronous reset would also blank a standing
    // error for the duration of every retry this effect now makes, flashing
    // the banner off and back on again for a dataset whose second attempt
    // fails the same way the first did.
    datasetDraftService
      .resolveOrCreateForDataset(editingDatasetId)
      .then(res => {
        if (cancelled) return
        setDraftError(null)
        setDraftId(res.data.id)
        setDraftArtifactId(res.data.currentArtifactId)
        setEditRootValidationRowCount(res.data.rootValidationRowCount)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setDraftError(
          err instanceof Error
            ? err.message
            : 'Could not prepare this dataset for editing.',
        )
      })
    return () => {
      cancelled = true
    }
  }, [
    mode,
    editingDatasetId,
    draftId,
    rowsSettledOnRealArtifact,
    setDraftId,
    setDraftArtifactId,
    setEditRootValidationRowCount,
  ])

  // DS-LAKE-024-T08 (openDecisions[3]). Derived from the LIVE rows state, not
  // from `dataset.currentArtifactId` — that snapshot is stale the moment
  // branch 2 materializes (see `rowsSettledOnRealArtifact` above), so keying
  // off it would leave a "no raw data" banner up over rows that had already
  // arrived.
  //
  // Only `'not-materialized'` maps here. `'bytes-missing'` is a different
  // statement ("it HAD rows and they are gone"), already carried by
  // DS-LAKE-025's own banner with its re-fetch remedy, and `'unreadable'`
  // is a transport failure rather than an absence.
  const rawDataAbsent: EditRawDataAbsent | null =
    mode !== 'edit'
      ? null
      : status === 'materializing'
        ? { materializing: true, reason: null }
        : syntheticCause === 'not-materialized'
          ? { materializing: false, reason: syntheticReason }
          : null

  // DS-LAKE-025. Surfaced so the wizard shell's reclaimed-bytes banner can
  // re-run hydration after a successful re-fetch — `createRaw` repoints
  // `Dataset.currentArtifactId` at the new BRONZE, and without a re-read the
  // wizard would keep showing the stand-in rows it fell back to.
  return { reload, draftError, rawDataAbsent }
}
