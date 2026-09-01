'use client'

import { useEffect, useRef } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { datasetDraftService } from '@/services/dataset-draft'
import { datasetArtifactService } from '@/services/dataset-version'
import { brandBoundedSample } from '@/lib/preprocessing'
import {
  dwDraftIdAtom,
  dwDraftArtifactIdAtom,
  dwEditingDatasetAtom,
  dwFeaturePreviewSampleAtom,
  dwFeaturePreviewSampleStateAtom,
  dwSelectedTagsAtom,
} from '@/store/dataset-studio'

const FEATURE_PREVIEW_SAMPLE_ROWS = 1_000

/** Mirrors `useArtifactRows`' own tag bound. Without a `tags` list the
 * server's `ListRowsSchema` reads "every tag" — tens of megabytes on a wide
 * artifact for a 1,000-row preview, exactly what `datasetArtifactService.rows`'
 * own doc comment warns callers against. */
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
  const [, setSample] = useAtom(dwFeaturePreviewSampleAtom)
  const [, setFetchState] = useAtom(dwFeaturePreviewSampleStateAtom)
  const tokenRef = useRef(0)

  const datasetId = editingDataset?.id ?? null
  const adoptedBronzeId = editingDataset?.adoptedBronzeArtifactId ?? null
  // Fresh array identity every render — key the effect on the joined string,
  // the same discipline every artifact hook in this folder already uses.
  const tagsKey = selectedTags.slice(0, PREVIEW_TAG_CAP).join(',')

  useEffect(() => {
    // Prefer the draft leg whenever a draft artifact exists — once Apply
    // creates a real SILVER in THIS draft, staying on the adopted BRONZE
    // would show raw rows for the rest of the session.
    const useDatasetLeg = !sourceArtifactId && !!datasetId && !!adoptedBronzeId
    const canFetch = useDatasetLeg || (!!draftId && !!sourceArtifactId)
    if (!canFetch) return

    const token = ++tokenRef.current
    setFetchState('loading')

    const params = {
      offset: 0,
      limit: FEATURE_PREVIEW_SAMPLE_ROWS,
      ...(tagsKey && { tags: tagsKey.split(',') }),
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
    setSample,
    setFetchState,
  ])
}
