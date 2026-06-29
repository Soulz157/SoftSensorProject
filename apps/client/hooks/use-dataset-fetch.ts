import { useCallback, useRef } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { type TimeRange } from '@/lib/mock-readings'
import { buildRawDataset } from '@/lib/preprocessing'
import {
  fetchStateAtom,
  rawDatasetAtom,
  type FetchState,
} from '@/store/data-visualize'

const STEP_MS = 300
const STEP_COUNT = 5

export interface UseDatasetFetchResult extends FetchState {
  start: (tags: string[], range: TimeRange) => void
  retry: (tags: string[], range: TimeRange) => void
}

/** Simulated fetch — fake-timer testable, mirrors a real network call's shape. */
export function useDatasetFetch(): UseDatasetFetchResult {
  const [fetchState, setFetchState] = useAtom(fetchStateAtom)
  const setRawDataset = useSetAtom(rawDatasetAtom)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const run = useCallback(
    (tags: string[], range: TimeRange) => {
      if (timerRef.current) clearInterval(timerRef.current)

      if (tags.length === 0) {
        setFetchState({
          status: 'error',
          progress: 0,
          error: 'No tags selected',
        })
        return
      }

      setFetchState({ status: 'fetching', progress: 0 })
      let step = 0
      timerRef.current = setInterval(() => {
        step += 1
        const progress = Math.min(100, Math.round((step / STEP_COUNT) * 100))
        if (step >= STEP_COUNT) {
          if (timerRef.current) clearInterval(timerRef.current)
          const raw = buildRawDataset(tags, range)
          setRawDataset(raw)
          setFetchState({ status: 'done', progress: 100 })
        } else {
          setFetchState({ status: 'fetching', progress })
        }
      }, STEP_MS)
    },
    [setFetchState, setRawDataset],
  )

  return { ...fetchState, start: run, retry: run }
}
