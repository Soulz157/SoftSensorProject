'use client'

import { useEffect, useRef } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { datasetDraftService } from '@/services/dataset-draft'
import { brandBoundedSample } from '@/lib/preprocessing'
import {
  dwDraftIdAtom,
  dwDraftArtifactIdAtom,
  dwFeaturePreviewSampleAtom,
} from '@/store/dataset-studio'

/**
 * Row cap for Step 4's local feature-engineering preview. Small on purpose —
 * unlike `useDatasetGoldWarm`'s server-side commit (which needs the real
 * artifact), this page is recomputed through `applyFeatures` on every recipe
 * edit in the browser, so it stays far under DS-LAKE-005B-A's 50,000-row
 * ceiling.
 */
const FEATURE_PREVIEW_SAMPLE_ROWS = 1_000

/**
 * DS-LAKE-006-AC5 / DS-LAKE-005B-B-T04: fetches ONE real bounded page (the
 * server's `/rows` endpoint, DS-LAKE-005B-A) of the draft's current source
 * artifact and brands it into `dwFeaturePreviewSampleAtom`.
 *
 * Runs once per draft/source-artifact — NOT once per recipe edit.
 * `dwFeaturedDatasetAtom` (store/dataset-studio.ts) is the thing that
 * recomputes `applyFeatures` on every recipe change, over this same fetched
 * page; re-fetching the page itself on every keystroke would be wasted
 * network traffic for data that has not changed.
 *
 * Call once near the top of `Step4FeatureEngineering` — mirrors
 * `useDatasetGoldWarm`'s call-site convention, but this hook takes no
 * arguments and returns nothing: it is a background sync, not a
 * caller-triggered action.
 *
 * NO-OP when the draft or its source artifact do not exist yet, same as
 * `useDatasetGoldWarm`. Failures are swallowed: this is a background
 * pre-warm with no dedicated failure UI, same reasoning as the gold-warm
 * hook's own doc comment — a stale/empty `dwFeaturePreviewSampleAtom` just
 * means Step 4's preview shows nothing yet, not a broken state.
 */
export function useDatasetFeaturePreviewSample(): void {
  const draftId = useAtomValue(dwDraftIdAtom)
  const sourceArtifactId = useAtomValue(dwDraftArtifactIdAtom)
  const [, setSample] = useAtom(dwFeaturePreviewSampleAtom)
  const tokenRef = useRef(0)

  useEffect(() => {
    if (!draftId || !sourceArtifactId) return
    const token = ++tokenRef.current

    void (async () => {
      try {
        const res = await datasetDraftService.rows(draftId, sourceArtifactId, {
          offset: 0,
          limit: FEATURE_PREVIEW_SAMPLE_ROWS,
        })
        if (tokenRef.current === token) {
          setSample(
            brandBoundedSample({ tags: res.data.tags, rows: res.data.rows }),
          )
        }
      } catch {
        // Swallowed on purpose — see module doc.
      }
    })()
  }, [draftId, sourceArtifactId, setSample])
}
