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
 * Session-lived cache of resolved artifact-metadata fetches, keyed
 * `${ownerId}:${artifactId}` — owner is a draftId or a datasetId. The two
 * legs below hit different auth-scoped routes for the same artifact, so the
 * owner stays part of the key rather than assuming the routes are
 * interchangeable. Shared by both hooks so a grid card's fetch is reused
 * when that same dataset's detail sheet opens next (DS-LAKE-013), instead of
 * repeating a request that just resolved.
 *
 * Caches RESOLVED promises only — a rejected one is deleted from the map in
 * its own `.catch`, never cached. Caching a rejection would pin one
 * transient failure (a 503, a network blip) for the rest of the session:
 * every later caller would replay the same rejected promise and that card
 * would stay blank until a full reload. Stale reads are not a risk this
 * needs to guard against — `currentArtifactId` moves when a post-save job
 * or an edit-save repoints it, and the key moves with it — but the map
 * itself is unbounded across a long session, so entries are evicted
 * oldest-first past `METADATA_CACHE_LIMIT` rather than left to grow forever.
 */
const METADATA_CACHE_LIMIT = 200
const metadataCache = new Map<string, Promise<DraftArtifactMetadata>>()

function getCachedMetadata(
  ownerId: string,
  artifactId: string,
  fetcher: () => Promise<{ data: DraftArtifactMetadata }>,
): Promise<DraftArtifactMetadata> {
  const key = `${ownerId}:${artifactId}`
  const cached = metadataCache.get(key)
  if (cached) return cached

  const promise = fetcher().then(res => res.data)
  // Evict on failure so the NEXT caller gets a fresh attempt rather than the
  // same rejection replayed forever.
  promise.catch(() => {
    metadataCache.delete(key)
  })

  if (metadataCache.size >= METADATA_CACHE_LIMIT) {
    // `Map` preserves insertion order — the first key is the oldest entry.
    const oldestKey = metadataCache.keys().next().value
    if (oldestKey !== undefined) metadataCache.delete(oldestKey)
  }
  metadataCache.set(key, promise)
  return promise
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
        const data = await getCachedMetadata(draftId, artifactId, () =>
          datasetDraftService.metadata(draftId, artifactId),
        )
        if (tokenRef.current === token) {
          setMetadata(data)
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
 * new one. Backs both the grid card and the detail sheet (DS-LAKE-013) —
 * the shared cache above means opening the sheet right after the card
 * rendered reuses that fetch instead of repeating it.
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
        const data = await getCachedMetadata(datasetId, artifactId, () =>
          datasetArtifactService.metadata(datasetId, artifactId),
        )
        if (tokenRef.current === token) {
          setMetadata(data)
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
