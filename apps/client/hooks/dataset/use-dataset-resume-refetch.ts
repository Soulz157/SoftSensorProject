'use client'

import { useEffect } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  dwCurrentStepAtom,
  dwFetchRequiredAtom,
  dwHighestUnlockedAtom,
} from '@/store/dataset-studio'
import { datasetResumeTargetAtom } from '@/hooks/dataset/dataset-draft-resume-state'
import type { UseDatasetStudioFetchResult } from '@/hooks/dataset/use-dataset-studio-fetch'
import type { FetchPeriod } from '@/store/model-pipeline'

/**
 * DS-LAKE-037. The second half of a resume (see `useDatasetDraftResume`):
 * while a resume target is pending, run the SAME fetch Step 2's button runs,
 * and when it lands release the saved step.
 *
 * Mounted from Step 2 so it drives that step's own `useDatasetStudioFetch`
 * instance - cancel and Retry keep working because there is only one fetch
 * run to cancel. If the fetch fails the target is kept, so the user's Retry
 * still ends on the step they left rather than on Step 2.
 *
 * `fetch.retry` is used (not `start`): the two are aliases, and `retry` is what
 * the step's own button calls.
 */
export function useDatasetResumeRefetch(
  fetch: Pick<UseDatasetStudioFetchResult, 'status' | 'retry'>,
  tags: string[],
  period: FetchPeriod,
): void {
  const [target, setTarget] = useAtom(datasetResumeTargetAtom)
  const fetchRequired = useAtomValue(dwFetchRequiredAtom)
  const setStep = useSetAtom(dwCurrentStepAtom)
  const setHighest = useSetAtom(dwHighestUnlockedAtom)
  const { status, retry } = fetch

  const pending = target !== null

  useEffect(() => {
    if (!pending || !fetchRequired || status !== 'idle') return
    retry(tags, period)
    // Run once per resume: `status` leaves 'idle' as soon as retry starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, fetchRequired, status])

  useEffect(() => {
    if (!target || status !== 'done') return
    setHighest(target.highestUnlocked)
    setStep(target.step)
    setTarget(null)
  }, [target, status, setHighest, setStep, setTarget])
}
