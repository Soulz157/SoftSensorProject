'use client'

import { useState } from 'react'
import { ApiError } from '@/lib/fetcher'
import { datasetArtifactService } from '@/services/dataset-version'
import type { DraftSplitStatsResult } from '@/services/dataset-version'
import { useDebouncedAbortableRequest } from '../internal/use-debounced-abortable-request'

export interface ArtifactSplitStatsState {
  splitStats: DraftSplitStatsResult | null
  loading: boolean
  /** A 404, VERBATIM — two distinct causes share this status and this
   * codebase already writes good copy for both, so the message is kept
   * rather than collapsed to a boolean: "Artifact not found" (the artifact
   * row itself is gone, from `dataset-version.authorized.service.ts`) and
   * "This dataset's stored rows are no longer available…" (the bytes were
   * reclaimed, from `python-client.ts`'s 404 mapping). Distinct from
   * `refusal`/`error` — same discipline `useArtifactValidationBoxplot`
   * establishes for its own `missing` state, extended to carry the text. */
  missing: string | null
  /** A 400 — the server's own refusal (a ratio that would leave one side
   * empty, or fewer than the trainer's own labelled-row floor). Surfaced
   * VERBATIM: `python-client.ts` maps a Python 422 through as a 400 whose
   * `message` IS the refusal text the panel should show, not a generic
   * "request failed". */
  refusal: string | null
  error: string | null
}

type FetchOutcome =
  | { kind: 'ready'; data: DraftSplitStatsResult }
  | { kind: 'missing'; message: string }
  | { kind: 'refused'; message: string }

/**
 * MODEL-FLOW-014-T04. Both sides of the train/test chronological split for
 * a dataset's committed artifact — mirrors `useArtifactCorrelation`'s shape
 * (fires once per (datasetId, artifactId, tags, targetY, splitRatio,
 * sampleRows)) with ONE deliberate divergence every other `artifact/*`
 * hook explicitly avoids: this one IS built on
 * `useDebouncedAbortableRequest`. Every sibling artifact hook argues a
 * committed artifact cannot change, so there is nothing to debounce or
 * supersede — true for their own request shape, but `splitRatio` here is a
 * live slider value the panel updates on every drag tick, so THIS request
 * changes continuously even though the underlying artifact does not.
 * Debounce/abort-on-supersede/cache come from the shared hook; see its own
 * doc comment.
 *
 * Failure states follow `useArtifactValidationBoxplot`'s precedent (404 ->
 * missing, 400 -> refusal, verbatim) — but classified via `err instanceof
 * ApiError && err.status`, NOT `(err as {statusCode}).statusCode`, which
 * several existing sibling hooks use and which is always `undefined` on the
 * real thrown `ApiError` (it exposes `.status`, never `.statusCode`) — a
 * pre-existing bug found while building this hook, left unfixed in those
 * files as out of MODEL-FLOW-014's scope, recorded in this feature's own
 * ledger entry rather than silently copied forward here.
 */
export function useArtifactSplitStats(
  datasetId: string | null,
  artifactId: string | null,
  tags: string[],
  targetY: string | null,
  splitRatio: number | null,
  sampleRows?: number,
  outlierCap?: number,
): ArtifactSplitStatsState {
  const [splitStats, setSplitStats] = useState<DraftSplitStatsResult | null>(
    null,
  )
  const [loading, setLoading] = useState(false)
  const [missing, setMissing] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const tagsKey = tags.join(',')

  const enabled =
    !!datasetId && !!artifactId && !!tagsKey && !!targetY && splitRatio !== null
  const cacheKey = enabled
    ? `split-stats|${datasetId}|${artifactId}|${tagsKey}|${targetY}|${splitRatio}|${sampleRows ?? ''}|${outlierCap ?? ''}`
    : null

  useDebouncedAbortableRequest<FetchOutcome>({
    enabled,
    cacheKey,
    fetcher: async signal => {
      try {
        const res = await datasetArtifactService.splitStats(
          datasetId!,
          artifactId!,
          {
            tags: tagsKey.split(','),
            targetY: targetY!,
            splitRatio: splitRatio!,
            ...(sampleRows && { sampleRows }),
            ...(outlierCap && { outlierCap }),
          },
          signal,
        )
        return { kind: 'ready', data: res.data }
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          return { kind: 'missing', message: err.message }
        }
        if (err instanceof ApiError && err.status === 400) {
          return { kind: 'refused', message: err.message }
        }
        throw err
      }
    },
    onLoading: () => {
      setSplitStats(null)
      setMissing(null)
      setRefusal(null)
      setError(null)
      setLoading(true)
    },
    onSettled: result => {
      if (result.status === 'ready') {
        const outcome = result.data
        if (outcome.kind === 'ready') {
          setSplitStats(outcome.data)
          setMissing(null)
          setRefusal(null)
        } else if (outcome.kind === 'missing') {
          setSplitStats(null)
          setMissing(outcome.message)
          setRefusal(null)
        } else {
          setSplitStats(null)
          setMissing(null)
          setRefusal(outcome.message)
        }
      } else {
        setSplitStats(null)
        setMissing(null)
        setRefusal(null)
        setError(result.error)
      }
      setLoading(false)
    },
    onIdle: () => {
      setSplitStats(null)
      setMissing(null)
      setRefusal(null)
      setError(null)
      setLoading(false)
    },
  })

  return { splitStats, loading, missing, refusal, error }
}
