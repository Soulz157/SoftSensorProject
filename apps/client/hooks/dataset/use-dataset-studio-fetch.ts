import { useCallback, useRef } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { dataSourceService } from '@/services/data-sources'
import {
  applyConstantOverlay,
  chunkTags,
  mergeDataset,
  piFetchInputError,
  piResponseToDataset,
  resolveInterval,
  toPiTime,
  type PiDataFetchResponse,
} from '@/lib/dataset-fetch'
import type { Dataset } from '@/lib/preprocessing'
import {
  dwCustomDateRangeAtom,
  dwCustomIntervalAtom,
  dwFetchConfigAtom,
  dwFetchProgressAtom,
  dwFetchStateAtom,
  dwRawDatasetAtom,
  dwSelectedSourcesAtom,
  dwTagConstantsAtom,
  EMPTY_FETCH_PROGRESS,
  type FetchProgress,
} from '@/store/dataset-studio'
import type { FetchPeriod } from '@/store/model-pipeline'
import type { FetchState } from '@/store/data-visualize'

export interface UseDatasetStudioFetchResult extends FetchState {
  /** Run the full fetch: chunk tags into batches and stream them in. */
  start: (tags: string[], period: FetchPeriod) => void
  /** Alias of `start` — a full re-run (used by the "Re-fetch" / error Retry). */
  retry: (tags: string[], period: FetchPeriod) => void
  /** Re-run ONLY the batches that failed on the previous run. Takes the same
   * (tags, period) as `start` so it can rebuild the request after a remount. */
  retryFailed: (tags: string[], period: FetchPeriod) => void
  /** Abort the in-flight run — settles to `idle`, never `error`. */
  cancel: () => void
  /** Rich per-batch progress (batch counts, current tags, ETA, failures). */
  detail: FetchProgress
}

const EMPTY_DATASET: Dataset = { tags: [], rows: [] }

/** Base fetch body (everything except the batch's `tagList`) + resolved source
 * + full tag list, captured on `start` so `retryFailed` can reissue identical
 * requests without re-reading the wizard controls. */
interface FetchContext {
  sourceId: string
  allTags: string[]
  bodyBase: Record<string, unknown>
}

/**
 * Fetch real raw readings for the wizard (P6 — client-orchestrated batches).
 *
 * The Python backend already chunks tags + time-windows internally, so a single
 * `/fetch` is fully batched server-side. This hook instead splits the tag list
 * into `batchSize` groups and issues them SEQUENTIALLY so the UI gets real
 * granularity the single call cannot expose: progress %, current batch, ETA,
 * cancel (AbortController), and retry-of-only-failed-batches. Each batch is
 * merged into `dwRawDatasetAtom` as it lands so partial results render live.
 * Sequential is intentionally slower than the server fan-out — the tradeoff buys
 * meaningful ETA and a clean cancel.
 *
 * Scope (F8): single PI/AVEVA source only (see `piFetchInputError`) — the flat
 * wizard tag list has no tag→source routing and SQL/REST need table/endpoint
 * selection the wizard does not collect. Edit-mode rehydration still rebuilds a
 * deterministic dataset via `buildRawDataset` in the store — unchanged.
 */
export function useDatasetStudioFetch(): UseDatasetStudioFetchResult {
  const [fetchState, setFetchState] = useAtom(dwFetchStateAtom)
  const [rawDataset, setRawDataset] = useAtom(dwRawDatasetAtom)
  const [progress, setProgress] = useAtom(dwFetchProgressAtom)
  const tagConstants = useAtomValue(dwTagConstantsAtom)
  const selectedSources = useAtomValue(dwSelectedSourcesAtom)
  const customDateRange = useAtomValue(dwCustomDateRangeAtom)
  const customInterval = useAtomValue(dwCustomIntervalAtom)
  const fetchConfig = useAtomValue(dwFetchConfigAtom)

  const controllerRef = useRef<AbortController | null>(null)
  const contextRef = useRef<FetchContext | null>(null)

  /**
   * Drive a set of tag-batches sequentially against the captured context,
   * merging successes into `dwRawDatasetAtom` and collecting failures. Shared by
   * the full run and the retry-failed path — the only difference is the starting
   * accumulator + progress seed.
   */
  const runBatches = useCallback(
    async (
      batches: string[][],
      initialAcc: Dataset,
      seed: {
        completedBatches: number
        completedTags: number
        totalBatches: number
      },
    ) => {
      const ctx = contextRef.current
      if (!ctx) return

      const controller = new AbortController()
      controllerRef.current = controller

      let acc = initialAcc
      let completedBatches = seed.completedBatches
      let completedTags = seed.completedTags
      const failedThisRun: string[][] = []
      const runStartedAt = Date.now()
      let batchesDoneThisRun = 0

      // Seed the bar from work already done (retryFailed after 4/6 succeeded
      // must not flash back to 0%).
      setFetchState({
        status: 'fetching',
        progress: Math.round((completedBatches / seed.totalBatches) * 100),
      })

      for (const batch of batches) {
        if (controller.signal.aborted) break
        setProgress(prev => ({ ...prev, currentBatchTags: batch }))

        try {
          const res = await dataSourceService.fetchData<PiDataFetchResponse>(
            ctx.sourceId,
            { ...ctx.bodyBase, tagList: batch },
            controller.signal,
          )
          // Fresh object every write — jotai bails on Object.is-equal values,
          // and the overlay is applied to the MERGED dataset (not per batch) so
          // constant tags cover rows added by later batches too.
          acc = mergeDataset(acc, piResponseToDataset(res.data, batch))
          const next = applyConstantOverlay(
            { tags: [...acc.tags], rows: acc.rows.map(r => ({ ...r })) },
            tagConstants,
            ctx.allTags,
          )
          setRawDataset(next)

          completedBatches += 1
          completedTags += batch.length
          batchesDoneThisRun += 1
          const elapsed = Date.now() - runStartedAt
          const remaining = batches.length - batchesDoneThisRun
          const etaMs =
            batchesDoneThisRun > 0 && remaining > 0
              ? Math.round((elapsed / batchesDoneThisRun) * remaining)
              : 0
          setProgress(prev => ({
            ...prev,
            completedBatches,
            completedTags,
            currentBatchTags: [],
            etaMs,
          }))
          setFetchState({
            status: 'fetching',
            progress: Math.round((completedBatches / seed.totalBatches) * 100),
          })
        } catch (err: unknown) {
          if (
            controller.signal.aborted ||
            (err instanceof DOMException && err.name === 'AbortError')
          ) {
            break
          }
          // Non-abort failure: record the batch and keep going so one bad batch
          // never loses the tags that would have succeeded after it.
          failedThisRun.push(batch)
          setProgress(prev => ({
            ...prev,
            currentBatchTags: [],
            failedBatches: [...prev.failedBatches, batch],
          }))
        }
      }

      controllerRef.current = null

      if (controller.signal.aborted) {
        // Cancel = discard. Settle to idle (NOT error, so the destructive alert
        // never fires) and clear the partial dataset — the idle branch renders
        // the "Ready to fetch" card, not the table, and step-2 advance is gated
        // on status==='done', so a truncated dataset must not linger in the atom
        // where a later goTo could carry it into preprocessing/save.
        setProgress({ ...EMPTY_FETCH_PROGRESS })
        setRawDataset(EMPTY_DATASET)
        setFetchState({ status: 'idle', progress: 0 })
        return
      }

      setProgress(prev => ({ ...prev, currentBatchTags: [], etaMs: null }))
      if (failedThisRun.length > 0) {
        setFetchState({
          status: 'error',
          progress: Math.round((completedBatches / seed.totalBatches) * 100),
          error: `${failedThisRun.length} of ${seed.totalBatches} batch${
            seed.totalBatches === 1 ? '' : 'es'
          } failed to fetch. Retry the failed batches or re-fetch.`,
        })
      } else {
        setFetchState({ status: 'done', progress: 100 })
      }
    },
    [setFetchState, setProgress, setRawDataset, tagConstants],
  )

  /**
   * Resolve + capture the fetch context from the current wizard controls. Shared
   * by `start` and `retryFailed` so the request body is built identically — and
   * so `retryFailed` can REBUILD it after the step unmounts/remounts (wizard-shell
   * switches steps, dropping `contextRef`, while the failure list survives in the
   * persisted progress atom). Everything it needs lives in persisted atoms.
   */
  const buildContext = useCallback(
    (
      tags: string[],
      period: FetchPeriod,
    ): { ok: true; context: FetchContext } | { ok: false; error: string } => {
      const guard = piFetchInputError(
        selectedSources,
        tags,
        customDateRange?.from,
        customDateRange?.to,
      )
      if (!guard.ok) return { ok: false, error: guard.error }

      // Summary Duration override wins; otherwise derive the bucket from the
      // Fetch Period / custom-interval control.
      const summaryDuration =
        fetchConfig.summaryDuration.trim() ||
        resolveInterval(period, customInterval)

      return {
        ok: true,
        context: {
          sourceId: guard.source.id,
          allTags: tags,
          bodyBase: {
            startTime: toPiTime(customDateRange!.from),
            endTime: toPiTime(customDateRange!.to),
            calBasis: fetchConfig.calBasis,
            summaryType: fetchConfig.summaryType,
            summaryDuration,
            batchSize: fetchConfig.batchSize,
          },
        },
      }
    },
    [selectedSources, customDateRange, customInterval, fetchConfig],
  )

  const start = useCallback(
    (tags: string[], period: FetchPeriod) => {
      const built = buildContext(tags, period)
      if (!built.ok) {
        // A fresh run supersedes any earlier partial/failed run — clear its
        // dataset + progress so the error branch cannot show a stale partial
        // table or a dead "Retry failed batches" button alongside this message.
        setRawDataset(EMPTY_DATASET)
        setProgress({ ...EMPTY_FETCH_PROGRESS })
        setFetchState({ status: 'error', progress: 0, error: built.error })
        return
      }
      contextRef.current = built.context

      const batches = chunkTags(tags, fetchConfig.batchSize)
      setRawDataset(EMPTY_DATASET)
      setProgress({
        ...EMPTY_FETCH_PROGRESS,
        totalBatches: batches.length,
        totalTags: tags.length,
      })
      void runBatches(batches, EMPTY_DATASET, {
        completedBatches: 0,
        completedTags: 0,
        totalBatches: batches.length,
      })
    },
    [
      buildContext,
      fetchConfig,
      setFetchState,
      setProgress,
      setRawDataset,
      runBatches,
    ],
  )

  const retryFailed = useCallback(
    (tags: string[], period: FetchPeriod) => {
      const failed = progress.failedBatches
      if (failed.length === 0) return
      // Rebuild the context from current controls — the ref may be null after a
      // step remount, but the persisted progress atom still holds the failures.
      const built = buildContext(tags, period)
      if (!built.ok) {
        setFetchState({ status: 'error', progress: 0, error: built.error })
        return
      }
      contextRef.current = built.context

      // Clear the failure list before re-running; runBatches re-adds any that
      // fail again. Keep the already-succeeded batch/tag counts as the seed.
      setProgress(prev => ({
        ...prev,
        failedBatches: [],
        currentBatchTags: [],
      }))
      void runBatches(failed, rawDataset, {
        completedBatches: progress.completedBatches,
        completedTags: progress.completedTags,
        totalBatches: progress.totalBatches || failed.length,
      })
    },
    [
      buildContext,
      progress,
      rawDataset,
      setFetchState,
      setProgress,
      runBatches,
    ],
  )

  const cancel = useCallback(() => {
    controllerRef.current?.abort()
  }, [])

  return {
    ...fetchState,
    start,
    retry: start,
    retryFailed,
    cancel,
    detail: progress,
  }
}
