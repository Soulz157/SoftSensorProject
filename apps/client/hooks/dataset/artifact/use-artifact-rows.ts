'use client'

import { useEffect, useRef, useState } from 'react'
import { datasetArtifactService } from '@/services/dataset-version'
import type { Dataset } from '@/lib/preprocessing'
import { previewRowLimit } from '@/lib/downsample'
import type { TimeWindow } from '@/lib/time-window'
import { set } from 'zod'

/** Bounded preview window, not the artifact. 200 rows is what the Data
 * preview table shows before it scrolls — pulling more would be paid for
 * on every sheet open and seen by nobody. */
const PREVIEW_ROWS = 200

/** Bounded preview width on the TAG axis, mirroring `PREVIEW_ROWS` on the row
 * axis. Without this, an unbounded `tags` list (or none at all — see
 * `datasetArtifactService.rows`'s own doc comment) means "every tag", which
 * on an 8,000-tag artifact turns a 200-row preview into tens of megabytes —
 * a real bug DS-LAKE-012 found live, not a hypothetical. */
const PREVIEW_TAGS = 50

export interface ArtifactRowsOptions {
  /** Row ceiling for a caller that wants more than the 200-row sheet
   * preview. The limit actually sent is `min(maxRows, previewRowLimit(tags))`
   * — rows × tags is what the payload scales with, so a wide selection gets
   * fewer rows. Ignored (200 stays) when `tags` is empty, because the server
   * reads an empty list as "every tag". */
  maxRows?: number
  /** Inclusive window, applied server-side BEFORE paging. */
  timeWindow?: TimeWindow | null
}

export function useArtifactRows(
  datasetId: string | null,
  artifactId: string | null,
  tags: string[] = [],
  options: ArtifactRowsOptions = {},
) {
  const [sample, setSample] = useState<Dataset | null>(null)
  // Rows the server holds inside the window — the whole match, not this page.
  const [totalRowCount, setTotalRowCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tokenRef = useRef(0)
  const sourceRef = useRef('')
  const boundedTags = tags.slice(0, PREVIEW_TAGS)
  // Stable content key, not the array reference: `tags` is a fresh array
  // every render from the caller (e.g. `dataset?.tags ?? []`), and that
  // reference changing must NOT be what re-triggers the fetch — only the
  // TAG LIST ITSELF changing should (notably: `dataset` loading in async
  // after this hook's first render, [] -> real tags, which the effect must
  // still pick up or it silently falls back to "no tags = every tag").
  const boundedTagsKey = boundedTags.join(',')
  const limit =
    options.maxRows && boundedTags.length > 0
      ? Math.min(options.maxRows, previewRowLimit(boundedTags.length))
      : PREVIEW_ROWS
  // Primitives, not the object: a `TimeWindow` is a fresh identity per render.
  const startTime = options.timeWindow?.startTime
  const endTime = options.timeWindow?.endTime

  useEffect(() => {
    const token = ++tokenRef.current
    setError(null)
    // A different SOURCE (dataset, artifact or tags) must never show the old
    // rows under the new one. A different WINDOW of the same source keeps them
    // until the next page lands, so whatever renders `sample` does not drop to
    // its empty state — or unmount — on every period change.
    const source = `${datasetId}|${artifactId}|${boundedTagsKey}`
    if (sourceRef.current !== source) {
      sourceRef.current = source
      setSample(null)
      setTotalRowCount(null)
    }

    if (!datasetId || !artifactId) {
      setLoading(false)
      return
    }

    setLoading(true)
    void (async () => {
      try {
        const res = await datasetArtifactService.rows(datasetId, artifactId, {
          offset: 0,
          limit,
          tags: boundedTags,
          ...(startTime && { startTime }),
          ...(endTime && { endTime }),
        })
        if (tokenRef.current !== token) return
        // `/rows` returns a page envelope; `DataTableView` wants a Dataset.
        setSample({ tags: res.data.tags, rows: res.data.rows })
        setTotalRowCount(res.data.totalRowCount)
        setLoading(false)
      } catch (err) {
        if (tokenRef.current === token) {
          setError(
            err instanceof Error ? err.message : 'Failed to load a preview',
          )
          setLoading(false)
        }
        setSample(null)
        setTotalRowCount(null)
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `boundedTags`
    // deliberately excluded (array reference changes every render);
    // `boundedTagsKey` is its stable stand-in.
  }, [datasetId, artifactId, boundedTagsKey, limit, startTime, endTime])

  return { sample, totalRowCount, loading, error }
}
