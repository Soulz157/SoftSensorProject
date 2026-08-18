'use client'

import { useEffect, useRef, useState } from 'react'
import { datasetDraftService } from '@/services/dataset-draft'
import type { DraftArtifactMetadata } from '@/services/dataset-draft'
import { datasetArtifactService } from '@/services/dataset-version'

export interface DatasetArtifactMetadataState {
  metadata: DraftArtifactMetadata | null
  loading: boolean
  error: string | null
}

/**
 * DS-LAKE-005B-B-T01 (Step 5 leg). Reads `GET .../artifacts/:artifactId/metadata`
 * — bounded viewport metadata (DS-LAKE-005B-A-T01), never a row payload — so
 * Step 5's stat tiles and target-tag banner can be fed from the FINAL
 * artifact instead of a client-computed `finalDataset`.
 *
 * Callers supply `artifactId` directly rather than this hook re-deriving it
 * from atoms: `useDatasetValidation`'s own `gateArtifactId` falls back to
 * SILVER when GOLD isn't ready, and SILVER has neither the derived features
 * nor the column selection applied — using it here would re-introduce, in
 * the display path, the exact defect `goldNotReady`
 * (`step-5-review-save.tsx`) exists to prevent. The caller is responsible
 * for passing `null` while a recipe with real features/column-selection is
 * waiting on GOLD, so this hook renders `loading` rather than a wrong-stage
 * count.
 *
 * `metadata` is cleared at the start of every run (mirrors
 * `useDatasetValidation`'s reset discipline) so a stale value from a
 * previous artifact id can never be shown against a new one, and a
 * token guard discards a resolved response whose artifact id has since
 * changed.
 */
export function useDatasetArtifactMetadata(
  draftId: string | null,
  artifactId: string | null,
): DatasetArtifactMetadataState {
  const [metadata, setMetadata] = useState<DraftArtifactMetadata | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tokenRef = useRef(0)

  useEffect(() => {
    const token = ++tokenRef.current
    setMetadata(null)
    setError(null)

    if (!draftId || !artifactId) {
      setLoading(false)
      return
    }

    setLoading(true)
    void (async () => {
      try {
        const res = await datasetDraftService.metadata(draftId, artifactId)
        if (tokenRef.current === token) {
          setMetadata(res.data)
          setLoading(false)
        }
      } catch (err) {
        if (tokenRef.current === token) {
          setError(
            err instanceof Error ? err.message : 'Failed to load metadata',
          )
          setLoading(false)
        }
      }
    })()
  }, [draftId, artifactId])

  return { metadata, loading, error }
}

/**
 * Saved-dataset twin of `useDatasetArtifactMetadata` (the draft leg). Same
 * token-guard + clear-on-rerun discipline: a resolved response whose
 * artifact id has since changed is discarded rather than shown against the
 * new one.
 */
export function useArtifactMetadata(
  datasetId: string | null,
  artifactId: string | null,
) {
  const [metadata, setMetadata] = useState<DraftArtifactMetadata | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tokenRef = useRef(0)

  useEffect(() => {
    const token = ++tokenRef.current
    setMetadata(null)
    setError(null)

    if (!datasetId || !artifactId) {
      setLoading(false)
      return
    }

    setLoading(true)
    void (async () => {
      try {
        const res = await datasetArtifactService.metadata(datasetId, artifactId)
        if (tokenRef.current === token) {
          setMetadata(res.data)
          setLoading(false)
        }
      } catch (err) {
        if (tokenRef.current === token) {
          setError(
            err instanceof Error ? err.message : 'Failed to load metadata',
          )
          setLoading(false)
        }
      }
    })()
  }, [datasetId, artifactId])

  return { metadata, loading, error }
}
