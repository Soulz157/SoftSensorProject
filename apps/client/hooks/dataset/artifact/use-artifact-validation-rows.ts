'use client'

import { useEffect, useRef, useState } from 'react'
import { datasetArtifactService } from '@/services/dataset-version'
import type { Dataset } from '@/lib/preprocessing'
import { previewRowLimit } from '@/lib/downsample'
import type { ArtifactRowsOptions } from './use-artifact-rows'

/** Same bound as `useArtifactRows`'s `PREVIEW_ROWS` — kept equal so neither
 * side of the compare view gets more resolution than the other for free.
 * There is no server-side decimation for the validation sidecar (confirmed:
 * `/v1/preprocess/rows` only offers a bounded offset/limit page, never a
 * time-bucketed read) — this is therefore a CHRONOLOGICAL PREFIX of the
 * artifact (or of the `timeWindow` when one is given), not an even sample
 * across its time range. The compare modal's caption says so; this is not a
 * hidden assumption. This is only the DEFAULT: the modal passes `maxRows` to
 * ask for more, see `ArtifactRowsOptions`. */
export const COMPARE_ROWS = 200

/** Mirrors `useArtifactRows`'s tag bound — a caller passing every dataset
 * tag would otherwise ask Python for every column's cells on a 500-row page. */
const COMPARE_TAGS = 50

/**
 * Validation-side counterpart to `useArtifactRows`, reading the run's
 * `validate_data.parquet` sidecar via the new `/validation-rows` route.
 *
 * No-ops (does not fetch) when `tags` is empty — unlike `/rows`'s own
 * "empty tags param = every tag" server default, an EXPLICIT empty
 * selection in the compare modal means "nothing chosen yet", never "give me
 * everything"; the modal's tag picker requires at least one tag before this
 * hook is asked to fetch.
 *
 * `missing` mirrors `useArtifactHoldout`: a 404 here means the run's
 * holdout sidecar is gone from storage (reclaimed) or the run has no
 * holdout at all — a different fact from a transport failure, and the
 * modal should only ever be open when `useArtifactHoldout` already reported
 * a holdout, so this branch means state changed between the two calls.
 */
export function useArtifactValidationRows(
  datasetId: string | null,
  artifactId: string | null,
  tags: string[] = [],
  options: ArtifactRowsOptions = {},
) {
  const [sample, setSample] = useState<Dataset | null>(null)
  // Rows the server holds inside the window — the whole match, not this page.
  const [totalRowCount, setTotalRowCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tokenRef = useRef(0)
  const sourceRef = useRef('')
  const boundedTags = tags.slice(0, COMPARE_TAGS)
  const boundedTagsKey = boundedTags.join(',')
  // Same rule as `useArtifactRows`, so the two compare sides can never be
  // handed different resolution for the same tag list.
  const limit =
    options.maxRows && boundedTags.length > 0
      ? Math.min(options.maxRows, previewRowLimit(boundedTags.length))
      : COMPARE_ROWS
  const startTime = options.timeWindow?.startTime
  const endTime = options.timeWindow?.endTime

  useEffect(() => {
    const token = ++tokenRef.current
    // Same source-vs-window rule as `useArtifactRows`: a new window of the
    // same source keeps the rows on screen until its page lands.
    const source = `${datasetId}|${artifactId}|${boundedTagsKey}`
    if (sourceRef.current !== source) {
      sourceRef.current = source
      setSample(null)
      setTotalRowCount(null)
    }
    setMissing(false)
    setError(null)

    if (!datasetId || !artifactId || boundedTags.length === 0) {
      setLoading(false)
      return
    }

    setLoading(true)
    void (async () => {
      try {
        const res = await datasetArtifactService.validationRows(
          datasetId,
          artifactId,
          {
            offset: 0,
            limit,
            tags: boundedTags,
            ...(startTime && { startTime }),
            ...(endTime && { endTime }),
          },
        )
        if (tokenRef.current !== token) return
        setSample({ tags: res.data.tags, rows: res.data.rows })
        setTotalRowCount(res.data.totalRowCount)
        setLoading(false)
      } catch (err) {
        if (tokenRef.current !== token) return
        setSample(null)
        setTotalRowCount(null)
        const status = (err as { statusCode?: number })?.statusCode
        if (status === 404) {
          setMissing(true)
        } else {
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to load validation rows',
          )
        }
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `boundedTags`
    // deliberately excluded (array reference changes every render);
    // `boundedTagsKey` is its stable stand-in, same pattern as `useArtifactRows`.
  }, [datasetId, artifactId, boundedTagsKey, limit, startTime, endTime])

  return { sample, totalRowCount, loading, missing, error }
}
