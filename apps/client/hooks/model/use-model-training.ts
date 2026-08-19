'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  modelDraftRunService,
  modelDraftService,
  type CreateDraftRunInput,
} from '@/services/model-draft'
import {
  mpTrainStateAtom,
  mpServerDraftIdAtom,
  mpTargetVariableAtom,
  mpAlgorithmsAtom,
  mpFindBestModelAtom,
  mpFindBestParamsAtom,
  mpHyperparamsAtom,
  mpTrainTestSplitAtom,
  mpSelectedDatasetAtom,
  mpTrainingResultAtom,
  mpArtifactRefAtom,
  ALGORITHM_LABELS,
  type TrainState,
  type Algorithm,
} from '@/store/model-pipeline'

const POLL_MS = 2500
/** Tolerate this many transient poll misses in a row before surfacing an error. */
const MAX_CONSECUTIVE_POLL_FAILURES = 3

export interface UseModelTrainingResult extends TrainState {
  start: () => void
  retry: () => void
  reset: () => void
}

interface Deps {
  /** From `useModelDraftSync()` — guarantees a server ModelDraft exists. */
  ensureDraftId: () => Promise<string | null>
}

/**
 * train.py's `build_model` (images/trainer/train.py) implements exactly 10
 * of the wizard's 12 catalogue entries — `lstm`/`gru` are the two still
 * deferred (need a windowing pipeline change train.py doesn't have yet).
 * Returns null for those so the caller refuses rather than spawning a
 * container that can only fail (MODEL-FLOW-003-T10).
 */
function toBackendAlgorithm(
  algorithm: Algorithm,
): CreateDraftRunInput['algorithm'] | null {
  return algorithm === 'lstm' || algorithm === 'gru' ? null : algorithm
}

/**
 * Phase-2 training driver (MODEL-FLOW-003). Creates a run against the
 * server-side ModelDraft and polls it to completion — no Model row, no
 * `useModelCommit()` call. That commit path is Step 4's alone now; calling
 * it from here was the exact violation this feature removes (see T03).
 */
export function useModelTraining({
  ensureDraftId,
}: Deps): UseModelTrainingResult {
  const [trainState, setTrainState] = useAtom(mpTrainStateAtom)
  const serverDraftId = useAtomValue(mpServerDraftIdAtom)
  const targetVariables = useAtomValue(mpTargetVariableAtom)
  const algorithms = useAtomValue(mpAlgorithmsAtom)
  const findBestModel = useAtomValue(mpFindBestModelAtom)
  const findBestParams = useAtomValue(mpFindBestParamsAtom)
  const hyperparameters = useAtomValue(mpHyperparamsAtom)
  const trainTestSplit = useAtomValue(mpTrainTestSplitAtom)
  const selectedDataset = useAtomValue(mpSelectedDatasetAtom)
  const setTrainingResult = useSetAtom(mpTrainingResultAtom)
  const setArtifactRef = useSetAtom(mpArtifactRefAtom)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const runningRef = useRef(false)
  /**
   * Consecutive poll failures. A single dropped request must not surface as
   * "Lost connection" while the container is still fitting fine — worse,
   * the user's only affordance from an error state is Retrain, which spawns
   * a SECOND container against the same draft (the backend only refuses a
   * SAVED/ABANDONED draft, not a still-training one). Tolerate a few
   * transient misses; only give up after several in a row.
   */
  const failCountRef = useRef(0)

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = null
  }, [])

  useEffect(() => stopPolling, [stopPolling])

  const pollRun = useCallback(
    (draftId: string, runId: string) => {
      stopPolling()
      failCountRef.current = 0

      const tick = async () => {
        try {
          const res = await modelDraftRunService.get(draftId, runId)
          failCountRef.current = 0
          const run = res.data
          const lastLog = run.logs[run.logs.length - 1]?.message

          if (run.status === 'QUEUED' || run.status === 'RUNNING') {
            setTrainState({ status: 'training', progress: 0, lastLog })
            return
          }

          stopPolling()
          runningRef.current = false

          if (run.status === 'SUCCEEDED') {
            setTrainingResult({
              runId: run.id,
              // Safe: the only algorithm a run can be created with today is
              // 'ols' (toBackendAlgorithm above refuses everything else
              // before create), and that value round-trips through the
              // backend's TrainingAlgorithmEnum unchanged.
              algorithm: run.algorithm as Algorithm,
              metrics: run.metrics,
              trainedAt: run.finishedAt ?? run.createdAt,
            })
            setArtifactRef(run.modelKey ?? null)
            setTrainState({ status: 'done', progress: 100, lastLog })
          } else {
            // FAILED or CANCELED.
            setTrainState({
              status: 'error',
              progress: 0,
              error:
                run.failureReason ??
                `Run ${run.status.toLowerCase()} with no reason recorded.`,
              lastLog,
            })
          }
        } catch (err) {
          failCountRef.current += 1
          if (failCountRef.current < MAX_CONSECUTIVE_POLL_FAILURES) return

          stopPolling()
          runningRef.current = false
          setTrainState({
            status: 'error',
            progress: 0,
            error:
              err instanceof Error && err.message
                ? err.message
                : 'Lost connection while checking on the run.',
          })
        }
      }

      void tick()
      pollRef.current = setInterval(() => void tick(), POLL_MS)
    },
    [setArtifactRef, setTrainState, setTrainingResult, stopPolling],
  )

  // Resume polling after a remount (Step 2 -> elsewhere -> Step 2) while a
  // run is still in flight server-side. Runs once on mount only — this is a
  // one-shot reconnect, not a subscription to every dependency change.
  useEffect(() => {
    if (trainState.status !== 'training') return
    if (pollRef.current) return
    if (!serverDraftId) return
    let cancelled = false
    void (async () => {
      try {
        const draftRes = await modelDraftService.get(serverDraftId)
        const runId = draftRes.data.currentRunId
        if (!runId || cancelled) return
        runningRef.current = true
        pollRun(serverDraftId, runId)
      } catch {
        // Best-effort reconnect — if this fails the user still has Retry.
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const run = useCallback(async () => {
    if (runningRef.current || trainState.status === 'training') return
    runningRef.current = true
    setTrainState({ status: 'training', progress: 0 })

    try {
      if (!selectedDataset) {
        throw new Error('No dataset selected — go back to Step 1.')
      }
      if (
        selectedDataset.currentArtifactType !== 'FINAL' ||
        !selectedDataset.currentArtifactId
      ) {
        throw new Error(
          `"${selectedDataset.name}" has no saved FINAL artifact yet — save the dataset in Data Studio first.`,
        )
      }
      // Narrowed with an explicit undefined check, not just a length
      // comparison — noUncheckedIndexedAccess means `arr[0]` stays
      // `T | undefined` to the type checker regardless of a prior
      // `arr.length === 1` check on a *different* expression.
      const [targetY] = targetVariables
      if (targetVariables.length !== 1 || !targetY) {
        throw new Error(
          targetVariables.length === 0
            ? 'Select a target variable before training.'
            : 'Select exactly one target — a run fits one target per model.',
        )
      }
      if (findBestModel || findBestParams) {
        throw new Error(
          "AutoML (Find Best Model / Find Best Parameters) isn't wired to a real training run yet — turn both off and pick a single algorithm.",
        )
      }
      const [algorithm] = algorithms
      if (algorithms.length !== 1 || !algorithm) {
        throw new Error(
          'Select exactly one algorithm — a run fits one algorithm per model.',
        )
      }
      const backendAlgorithm = toBackendAlgorithm(algorithm)
      if (!backendAlgorithm) {
        throw new Error(
          `"${ALGORITHM_LABELS[algorithm]}" isn't supported by the training service yet — pick Linear Regression.`,
        )
      }

      const draftId = await ensureDraftId()
      if (!draftId) {
        throw new Error("Model draft isn't ready yet — check Step 1.")
      }

      const created = await modelDraftRunService.create(draftId, {
        goldArtifactId: selectedDataset.currentArtifactId,
        targetY,
        algorithm: backendAlgorithm,
        hyperparameters,
        // FRACTION, never a percentage — converted once, here, at the
        // client boundary (same rule useModelDraftSync's PATCH follows).
        trainTestSplit: trainTestSplit / 100,
      })

      pollRun(draftId, created.data.id)
    } catch (err) {
      runningRef.current = false
      setTrainState({
        status: 'error',
        progress: 0,
        error:
          err instanceof Error && err.message
            ? err.message
            : 'Failed to start training.',
      })
    }
  }, [
    trainState.status,
    selectedDataset,
    targetVariables,
    findBestModel,
    findBestParams,
    algorithms,
    hyperparameters,
    trainTestSplit,
    ensureDraftId,
    pollRun,
    setTrainState,
  ])

  const reset = useCallback(() => {
    stopPolling()
    runningRef.current = false
    setTrainState({ status: 'idle', progress: 0 })
  }, [setTrainState, stopPolling])

  return { ...trainState, start: run, retry: run, reset }
}
