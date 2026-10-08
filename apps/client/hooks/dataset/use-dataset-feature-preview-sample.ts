'use client'

import { useEffect, useRef } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { datasetDraftService } from '@/services/dataset-draft'
import { datasetArtifactService } from '@/services/dataset-version'
import { brandBoundedSample } from '@/lib/preprocessing'
import { previewRowLimit } from '@/lib/downsample'
import {
  dwDraftIdAtom,
  dwDraftArtifactIdAtom,
  dwEdaSampleTotalAtom,
  dwEdaWindowAtom,
  dwEditingDatasetAtom,
  dwFeaturePreviewSampleAtom,
  dwFeaturePreviewSampleStateAtom,
  dwSelectedTagsAtom,
} from '@/store/dataset-studio'

/** Mirrors `useArtifactRows`' own tag bound, and only bounds the DATASET leg:
 * `datasetArtifactService.rows` projects to this many tags. The DRAFT leg
 * (`datasetDraftService.rows`) sends no `tags`, so it returns EVERY column of
 * the artifact whatever this is — which is why the row limit below is sized
 * from the full selected count, not this capped one. This DB holds an
 * 8,000-column BRONZE; 10,000 rows of that would be hundreds of megabytes. */
const PREVIEW_TAG_CAP = 50

/**
 * …(doc comment เดิม)…
 *
 * TWO LEGS. Create mode reads the draft's own source artifact, gated
 * `where: { id, draftId }`. Edit mode has NO draft artifact until the user's
 * first Apply — its rows live on the BRONZE adopted at Save
 * (DS-LAKE-017-T01), gated `where: { id, datasetId }`, which the draft leg
 * cannot see because that artifact's `draftId` belongs to the draft that
 * originally created it.
 *
 * Without the second leg this hook no-op'd in edit mode and the sample
 * stayed empty — and because every DataAnalysisCard tab checks `hasTags`
 * before anything else, an empty sample pins all four to 'no-tags'
 * regardless of which leg their own hooks were routed to. That is why
 * routing the card's hooks alone was not enough.
 */
export function useDatasetFeaturePreviewSample(): void {
  const draftId = useAtomValue(dwDraftIdAtom)
  const sourceArtifactId = useAtomValue(dwDraftArtifactIdAtom)
  const editingDataset = useAtomValue(dwEditingDatasetAtom)
  const selectedTags = useAtomValue(dwSelectedTagsAtom)
  const timeWindow = useAtomValue(dwEdaWindowAtom)
  const [, setSample] = useAtom(dwFeaturePreviewSampleAtom)
  const [, setFetchState] = useAtom(dwFeaturePreviewSampleStateAtom)
  const setSampleTotal = useSetAtom(dwEdaSampleTotalAtom)
  const tokenRef = useRef(0)

  const datasetId = editingDataset?.id ?? null
  const adoptedBronzeId = editingDataset?.adoptedBronzeArtifactId ?? null
  // Fresh array identity every render — key the effect on the joined string,
  // the same discipline every artifact hook in this folder already uses.
  const tagsKey = selectedTags.slice(0, PREVIEW_TAG_CAP).join(',')
  // Rows are sized to the WIDTH of what comes back, not a flat count — see
  // `previewRowLimit`. On the draft leg that width is every column of the
  // artifact, which in create mode is the selected tags, UNCAPPED. Sizing from
  // the capped list would let a 200-tag selection ask for 8,000 rows × 200
  // columns. (Conservative for the dataset leg, which does project to the cap.)
  // No selected tags reads as "unknown width", so assume the cap.
  const limit = previewRowLimit(selectedTags.length || PREVIEW_TAG_CAP)
  // Primitives, not the object: a `TimeWindow` is a fresh identity per render.
  const startTime = timeWindow?.startTime
  const endTime = timeWindow?.endTime

  useEffect(() => {
    // Prefer the draft leg whenever a draft artifact exists — once Apply
    // creates a real SILVER in THIS draft, staying on the adopted BRONZE
    // would show raw rows for the rest of the session.
    const useDatasetLeg = !sourceArtifactId && !!datasetId && !!adoptedBronzeId
    const canFetch = useDatasetLeg || (!!draftId && !!sourceArtifactId)
    if (!canFetch) return

    const token = ++tokenRef.current
    // A sample already on screen stays there while the next one loads
    // ('refreshing'), so changing the window does not read as a first load:
    // Step 3.1 unmounts the whole analysis card on 'loading', which would
    // throw away the open tab, the scatter axes and the window picker itself.
    setFetchState(prev => (prev === 'ready' ? 'refreshing' : 'loading'))

    const params = {
      offset: 0,
      limit,
      ...(tagsKey && { tags: tagsKey.split(',') }),
      ...(startTime && { startTime }),
      ...(endTime && { endTime }),
    }

    void (async () => {
      try {
        let res
        if (useDatasetLeg) {
          res = await datasetArtifactService.rows(
            datasetId!,
            adoptedBronzeId!,
            params,
          )
        } else {
          try {
            res = await datasetDraftService.rows(
              draftId!,
              sourceArtifactId!,
              params,
            )
          } catch (draftLegError) {
            // DS-LAKE-027. The draft leg is chosen purely because a draft
            // artifact id EXISTS — never because its bytes were checked. An
            // id whose object is gone (reclaimed, or missing outside the
            // ledger) therefore used to blank the whole analysis card with
            // no way back, even though the dataset's own adopted BRONZE was
            // sitting right there, readable. The backend now self-heals such
            // an id at resolve time; this is the belt to that braces, so one
            // bad id can never again cost the entire card.
            if (!datasetId || !adoptedBronzeId) throw draftLegError
            res = await datasetArtifactService.rows(
              datasetId,
              adoptedBronzeId,
              params,
            )
          }
        }
        if (tokenRef.current === token) {
          setSample(
            brandBoundedSample({ tags: res.data.tags, rows: res.data.rows }),
          )
          setSampleTotal(res.data.totalRowCount)
          setFetchState('ready')
        }
      } catch {
        // Swallowed on purpose — see module doc.
        if (tokenRef.current === token) setFetchState('error')
      }
    })()
  }, [
    draftId,
    sourceArtifactId,
    datasetId,
    adoptedBronzeId,
    tagsKey,
    limit,
    startTime,
    endTime,
    setSample,
    setSampleTotal,
    setFetchState,
  ])
}
