import { useCallback, useRef } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { type TimeRange } from '@/lib/mock-readings'
import { buildRawDataset } from '@/lib/preprocessing'
import {
  mpFetchStateAtom,
  mpRawDatasetAtom,
  PERIOD_TO_RANGE,
  type FetchPeriod,
} from '@/store/model-pipeline'
import type { FetchState } from '@/store/data-visualize'

const STEP_MS = 300
const STEP_COUNT = 5

export interface UseModelDatasetFetchResult extends FetchState {
  start: (tags: string[], period: FetchPeriod) => void
  retry: (tags: string[], period: FetchPeriod) => void
}

export function useModelDatasetFetch(): UseModelDatasetFetchResult {
  const [fetchState, setFetchState] = useAtom(mpFetchStateAtom)
  const setRawDataset = useSetAtom(mpRawDatasetAtom)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const run = useCallback(
    (tags: string[], period: FetchPeriod) => {
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
          setRawDataset(buildRawDataset(tags, PERIOD_TO_RANGE[period]))
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
