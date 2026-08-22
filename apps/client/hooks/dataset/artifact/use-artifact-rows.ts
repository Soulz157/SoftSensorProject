'use client'

import { useEffect, useRef, useState } from 'react'
import { datasetArtifactService } from '@/services/dataset-version'
import type { Dataset } from '@/lib/preprocessing'
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

export function useArtifactRows(
  datasetId: string | null,
  artifactId: string | null,
  tags: string[] = [],
) {
  const [sample, setSample] = useState<Dataset | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tokenRef = useRef(0)
  const boundedTags = tags.slice(0, PREVIEW_TAGS)
  // Stable content key, not the array reference: `tags` is a fresh array
  // every render from the caller (e.g. `dataset?.tags ?? []`), and that
  // reference changing must NOT be what re-triggers the fetch — only the
  // TAG LIST ITSELF changing should (notably: `dataset` loading in async
  // after this hook's first render, [] -> real tags, which the effect must
  // still pick up or it silently falls back to "no tags = every tag").
  const boundedTagsKey = boundedTags.join(',')

  useEffect(() => {
    const token = ++tokenRef.current
    setSample(null)

    if (!datasetId || !artifactId) {
      setLoading(false)
      return
    }

    setLoading(true)
    void (async () => {
      try {
        const res = await datasetArtifactService.rows(datasetId, artifactId, {
          offset: 0,
          limit: PREVIEW_ROWS,
          tags: boundedTags,
        })
        if (tokenRef.current !== token) return
        // `/rows` returns a page envelope; `DataTableView` wants a Dataset.
        setSample({ tags: res.data.tags, rows: res.data.rows })
        setLoading(false)
      } catch (err) {
        if (tokenRef.current === token) {
          setError(
            err instanceof Error ? err.message : 'Failed to load a preview',
          )
          setLoading(false)
        }
        setSample(null)
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `boundedTags`
    // deliberately excluded (array reference changes every render);
    // `boundedTagsKey` is its stable stand-in.
  }, [datasetId, artifactId, boundedTagsKey])

  return { sample, loading, error }
}
