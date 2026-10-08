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
  // Settled page tagged with BOTH the source and the exact request it
  // answers. Everything the effect used to reset synchronously is derived
  // from those two keys during render instead.
  const [settled, setSettled] = useState<{
    source: string
    key: string
    sample: Dataset | null
    // Rows the server holds inside the window — the whole match, not this page.
    totalRowCount: number | null
    error: string | null
  } | null>(null)
  const tokenRef = useRef(0)
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

  // A different SOURCE (dataset, artifact or tags) must never show the old
  // rows under the new one. A different WINDOW of the same source keeps them
  // until the next page lands, so whatever renders `sample` does not drop to
  // its empty state — or unmount — on every period change.
  const source = `${datasetId}|${artifactId}|${boundedTagsKey}`
  const requestKey =
    datasetId && artifactId
      ? JSON.stringify([source, limit, startTime, endTime])
      : null

  useEffect(() => {
    const token = ++tokenRef.current
    if (!requestKey || !datasetId || !artifactId) return

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
        setSettled({
          source,
          key: requestKey,
          sample: { tags: res.data.tags, rows: res.data.rows },
          totalRowCount: res.data.totalRowCount,
          error: null,
        })
      } catch (err) {
        if (tokenRef.current !== token) return
        setSettled({
          source,
          key: requestKey,
          sample: null,
          totalRowCount: null,
          error:
            err instanceof Error ? err.message : 'Failed to load a preview',
        })
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `boundedTags`
    // deliberately excluded (array reference changes every render);
    // `boundedTagsKey` (inside `source`) is its stable stand-in.
  }, [requestKey, datasetId, artifactId, source, limit, startTime, endTime])

  const sameSource = settled?.source === source
  const current = settled?.key === requestKey ? settled : null
  return {
    sample: sameSource ? (settled?.sample ?? null) : null,
    totalRowCount: sameSource ? (settled?.totalRowCount ?? null) : null,
    loading: requestKey !== null && current === null,
    error: current?.error ?? null,
  }
}
