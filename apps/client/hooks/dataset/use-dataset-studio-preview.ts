import { useCallback, useState } from 'react'
import { useAtomValue } from 'jotai'
import { dataSourceService } from '@/services/data-sources'
import {
  applyConstantOverlay,
  parseDurationMs,
  piFetchInputError,
  piResponseToDataset,
  previewWindow,
  resolveInterval,
  type PiDataFetchResponse,
} from '@/lib/dataset-fetch'
import type { Dataset } from '@/lib/preprocessing'
import {
  dwCustomDateRangeAtom,
  dwCustomIntervalAtom,
  dwFetchConfigAtom,
  dwSelectedSourcesAtom,
  dwTagConstantsAtom,
} from '@/store/dataset-studio'
import type { FetchPeriod } from '@/store/model-pipeline'

const PREVIEW_ROWS = 100

export type PreviewStatus = 'idle' | 'loading' | 'done' | 'error'

export interface UseDatasetStudioPreviewResult {
  status: PreviewStatus
  error: string | null
  dataset: Dataset | null
  /** Note shown when the Summary Duration override is unparseable and the
   * preview used the Fetch Period bucket instead. */
  notice: string | null
  run: (tags: string[], period: FetchPeriod) => void
}

/**
 * Cheap validation preview (Step 6): fetches only the FIRST ~100 rows by
 * narrowing the time window to `start → start + 100 buckets`, so the user can
 * sanity-check the summary config / quality before committing to the full
 * background run (P6). Deliberately kept OUT of `dwFetchStateAtom` — preview must
 * not drive the wizard's auto-advance-on-done effect. Single-PI-source scope,
 * shared with the full fetch via `piFetchInputError`.
 */
export function useDatasetStudioPreview(): UseDatasetStudioPreviewResult {
  const selectedSources = useAtomValue(dwSelectedSourcesAtom)
  const customDateRange = useAtomValue(dwCustomDateRangeAtom)
  const customInterval = useAtomValue(dwCustomIntervalAtom)
  const fetchConfig = useAtomValue(dwFetchConfigAtom)
  const tagConstants = useAtomValue(dwTagConstantsAtom)

  const [status, setStatus] = useState<PreviewStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const run = useCallback(
    (tags: string[], period: FetchPeriod) => {
      setNotice(null)
      const guard = piFetchInputError(
        selectedSources,
        tags,
        customDateRange?.from,
        customDateRange?.to,
      )
      if (!guard.ok) {
        setStatus('error')
        setError(guard.error)
        return
      }
      // customDateRange is non-null here (guard checked from/to).
      const from = customDateRange!.from
      const to = customDateRange!.to

      // Effective bucket: a valid override wins; otherwise the Fetch Period
      // bucket. A bad override never widens the preview window — it just falls
      // back to the period and tells the user.
      const override = fetchConfig.summaryDuration.trim()
      const periodBucket = resolveInterval(period, customInterval)
      let effective = periodBucket
      if (override) {
        if (parseDurationMs(override) !== null) {
          effective = override
        } else {
          setNotice(
            `Unrecognized summary duration "${override}" — previewing with the Fetch Period bucket (${periodBucket}).`,
          )
        }
      }

      const win = previewWindow(from, to, effective, PREVIEW_ROWS)

      setStatus('loading')
      setError(null)

      dataSourceService
        .fetchData<PiDataFetchResponse>(guard.source.id, {
          tagList: tags,
          startTime: win.startTime,
          endTime: win.endTime,
          calBasis: fetchConfig.calBasis,
          summaryType: fetchConfig.summaryType,
          summaryDuration: effective,
          batchSize: fetchConfig.batchSize,
        })
        .then(res => {
          const full = applyConstantOverlay(
            piResponseToDataset(res.data, tags),
            tagConstants,
            tags,
          )
          // Safety net: the summary read can return a boundary row past the
          // window, so cap the rendered rows even after narrowing.
          const preview: Dataset = {
            tags: full.tags,
            rows: full.rows.slice(0, PREVIEW_ROWS),
          }
          setDataset(preview)
          setStatus('done')
        })
        .catch((err: unknown) => {
          setStatus('error')
          setError(
            err instanceof Error ? err.message : 'Failed to fetch preview.',
          )
        })
    },
    [
      selectedSources,
      customDateRange,
      customInterval,
      fetchConfig,
      tagConstants,
    ],
  )

  return { status, error, dataset, notice, run }
}
