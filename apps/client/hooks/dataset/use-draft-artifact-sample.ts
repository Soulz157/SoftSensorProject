'use client'

import { useEffect, useRef, useState } from 'react'
import { datasetDraftService } from '@/services/dataset-draft'
import { brandBoundedSample, type BoundedSample } from '@/lib/preprocessing'
import { previewRowLimit } from '@/lib/downsample'

/** Assumed width when the artifact's own column count is not known yet —
 * `useArtifactRows`' preview tag cap. */
const DEFAULT_COLUMNS = 50

const EMPTY: BoundedSample = brandBoundedSample({ tags: [], rows: [] })

export interface DraftArtifactSampleState {
  sample: BoundedSample
  /** Rows the artifact holds — the whole of it, not this page. */
  totalRowCount: number | null
  loading: boolean
  error: string | null
}

interface Loaded {
  /** `draftId|artifactId` the page belongs to. */
  key: string
  sample: BoundedSample
  totalRowCount: number | null
  error: string | null
}

/**
 * DS-LAKE-034-D01. A bounded row page of ONE draft artifact — the draft-leg
 * twin of `useArtifactRows` (which reads the dataset leg). First caller is
 * Step 6, which shows `DataAnalysisCard` over the GOLD artifact it is about to
 * save; the card's server tabs already read that same artifact, and this is
 * what feeds its Line / Raw table / stats views.
 *
 * The draft `/rows` route cannot project tags — it returns every column — so
 * the row count is sized from `columnCount` (`previewRowLimit`), never a flat
 * number: a wide GOLD at a fixed row count could run to hundreds of
 * megabytes. A page is keyed to the artifact it came from, so when the
 * artifact rotates (a new GOLD) the old rows are never shown under it.
 */
export function useDraftArtifactSample(
  draftId: string | null,
  artifactId: string | null,
  columnCount: number | null,
): DraftArtifactSampleState {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const tokenRef = useRef(0)
  const limit = previewRowLimit(columnCount || DEFAULT_COLUMNS)
  const key = draftId && artifactId ? `${draftId}|${artifactId}` : null

  useEffect(() => {
    const token = ++tokenRef.current
    if (!draftId || !artifactId) return
    const pageKey = `${draftId}|${artifactId}`

    void (async () => {
      try {
        const res = await datasetDraftService.rows(draftId, artifactId, {
          offset: 0,
          limit,
        })
        if (tokenRef.current !== token) return
        setLoaded({
          key: pageKey,
          sample: brandBoundedSample({
            tags: res.data.tags,
            rows: res.data.rows,
          }),
          totalRowCount: res.data.totalRowCount,
          error: null,
        })
      } catch (err) {
        if (tokenRef.current !== token) return
        setLoaded({
          key: pageKey,
          sample: EMPTY,
          totalRowCount: null,
          error: err instanceof Error ? err.message : 'Failed to load rows',
        })
      }
    })()
  }, [draftId, artifactId, limit])

  const current = loaded && loaded.key === key ? loaded : null
  return {
    sample: current?.sample ?? EMPTY,
    totalRowCount: current?.totalRowCount ?? null,
    loading: key !== null && current === null,
    error: current?.error ?? null,
  }
}
