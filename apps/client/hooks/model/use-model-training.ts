'use client'

import { useCallback, useRef } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { useModelCommit } from '@/hooks/model/use-model-commit'
import {
  mpModeAtom,
  mpTrainStateAtom,
  type TrainState,
} from '@/store/model-pipeline'

const STEP_MS = 400
const STEP_COUNT = 6

export interface UseModelTrainingResult extends TrainState {
  start: () => void
  retry: () => void
}

/**
 * Phase-5 training driver. Persists the model + its wizard config via the shared
 * `useModelCommit` path (create-once-then-update / edit→update), then runs the
 * mock progress ramp. Training progress itself is mock — there is no backend
 * training endpoint (Phase 6).
 */
export function useModelTraining(): UseModelTrainingResult {
  const [trainState, setTrainState] = useAtom(mpTrainStateAtom)
  const mode = useAtomValue(mpModeAtom)
  const commit = useModelCommit()
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const runningRef = useRef(false)

  const runRamp = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    setTrainState({ status: 'training', progress: 0 })
    let step = 0
    timerRef.current = setInterval(() => {
      step += 1
      const progress = Math.min(100, Math.round((step / STEP_COUNT) * 100))
      if (step >= STEP_COUNT) {
        if (timerRef.current) clearInterval(timerRef.current)
        setTrainState({ status: 'done', progress: 100 })
      } else {
        setTrainState({ status: 'training', progress })
      }
    }, STEP_MS)
  }, [setTrainState])

  const run = useCallback(async () => {
    if (runningRef.current || trainState.status === 'training') return
    runningRef.current = true
    setTrainState({ status: 'training', progress: 0 })

    try {
      await commit()
    } catch {
      runningRef.current = false
      setTrainState({
        status: 'error',
        progress: 0,
        error:
          mode === 'edit'
            ? 'Failed to save changes. Retry.'
            : 'Failed to create model. Check details and retry.',
      })
      return
    }

    runningRef.current = false
    runRamp()
  }, [trainState.status, mode, commit, setTrainState, runRamp])

  return { ...trainState, start: run, retry: run }
}
