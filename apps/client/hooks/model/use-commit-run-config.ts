'use client'

import { useCallback } from 'react'
import { useSetAtom } from 'jotai'
import { mpTrainStateAtom, mpHighestUnlockedAtom } from '@/store/model-pipeline'

/**
 * MODEL-FLOW-014-T08. The one relock pair every Apply of run configuration
 * must perform after writing its own committed atoms: training state back
 * to idle, and Step 3+ relocked so a `trainState: 'done'` from before the
 * edit can't carry a user past Evaluation on parameters that no longer
 * match it. Previously duplicated in nine places — every per-field setter
 * in `use-model-pipeline-nav.ts` (now deleted, replaced by
 * `useRunConfigDraft`'s single `apply()`) and `useApplyRunParams`
 * (`use-apply-run-params.ts`).
 *
 * Deliberately does NOT write the run-config atoms themselves. Step 3's own
 * Apply (`useRunConfigDraft`) and the Recall panel's Apply
 * (`useApplyRunParams`) commit different field sets — a run row has no
 * `lossFunction`/`seed` column, so Recall's Apply never touches those two
 * atoms — so each caller keeps writing its own atoms and calls this
 * afterward, once, rather than one shared writer fighting that asymmetry.
 */
export function useCommitRunConfig(): () => void {
  const setTrainState = useSetAtom(mpTrainStateAtom)
  const setHighestUnlocked = useSetAtom(mpHighestUnlockedAtom)

  return useCallback(() => {
    setTrainState({ status: 'idle', progress: 0 })
    setHighestUnlocked(prev => Math.min(prev, 3))
  }, [setTrainState, setHighestUnlocked])
}
