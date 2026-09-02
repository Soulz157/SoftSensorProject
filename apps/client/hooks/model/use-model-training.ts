'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  modelDraftRunService,
  modelDraftCandidateJobService,
  modelDraftService,
  type CreateDraftRunInput,
  type ModelCandidateJob,
} from '@/services/model-draft'
import { defaultHyperparams } from '@/lib/training-config'
import {
  mpTrainStateAtom,
  mpServerDraftIdAtom,
  mpTargetVariableAtom,
  mpAlgorithmsAtom,
  mpFindBestModelAtom,
  mpFindBestParamsAtom,
  mpHyperparamsAtom,
  mpTrainTestSplitAtom,
  mpSplitStatsTagsAtom,
  mpSeedAtom,
  mpNSplitsAtom,
  mpSelectedDatasetAtom,
  mpTrainingResultAtom,
  mpCandidateJobIdAtom,
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
  const splitStatsTags = useAtomValue(mpSplitStatsTagsAtom)
  const seed = useAtomValue(mpSeedAtom)
  const nSplits = useAtomValue(mpNSplitsAtom)
  const selectedDataset = useAtomValue(mpSelectedDatasetAtom)
  const setTrainingResult = useSetAtom(mpTrainingResultAtom)
  const setArtifactRef = useSetAtom(mpArtifactRefAtom)
  const [candidateJobId, setCandidateJobId] = useAtom(mpCandidateJobIdAtom)

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
              cvFoldsKey: run.cvFoldsKey,
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

  /**
   * MODEL-FLOW-013-T07/T11. Polls a candidate job (an algorithm sweep, a
   * sweep-then-tune job, or a bare hyperparameter search) to completion —
   * same shape as `pollRun`, different endpoint. `trainState`/the rest of
   * Step 3's UI (progress text, Retrain button) is reused UNCHANGED:
   * QUEUED/RUNNING still maps to 'training', SUCCEEDED to 'done',
   * FAILED/CANCELED to 'error'. On success, `mpTrainingResultAtom` is
   * populated from the WINNING candidate (`job.bestRunId`) — the metric's
   * own answer (a phase-2 tuning run if one beat phase 1, else phase 1's
   * own winner), before any user selection at Step 4 (T08) can override
   * what Evaluation resolves.
   *
   * `totalRuns` can GROW mid-poll for a SWEEP_THEN_TUNE job — the server
   * appends phase 2 once phase 1 exhausts (see
   * `model-candidate-job.authorized.service.ts`'s `advanceJobForRun`) — so
   * the progress text always reads the job's CURRENT `totalRuns`, never a
   * value captured once at job creation.
   */
  const pollJob = useCallback(
    (draftId: string, jobId: string) => {
      stopPolling()
      failCountRef.current = 0

      const tick = async () => {
        try {
          const res = await modelDraftCandidateJobService.get(draftId, jobId)
          failCountRef.current = 0
          const job: ModelCandidateJob = res.data

          if (job.status === 'QUEUED' || job.status === 'RUNNING') {
            const inFlight = job.candidates[job.completedRuns]
            const position = `${Math.min(job.completedRuns + 1, job.totalRuns)} of ${job.totalRuns}`
            setTrainState({
              status: 'training',
              progress: 0,
              lastLog:
                inFlight?.phase === 2
                  ? `Tuning ${ALGORITHM_LABELS[inFlight.algorithm as Algorithm] ?? inFlight.algorithm} — ${position}…`
                  : `Candidate ${position}…`,
            })
            return
          }

          stopPolling()
          runningRef.current = false

          if (job.status === 'SUCCEEDED') {
            const winner = job.candidates.find(c => c.runId === job.bestRunId)
            if (!winner || !winner.runId) {
              setTrainState({
                status: 'error',
                progress: 0,
                error:
                  'The sweep finished but recorded no winning candidate — this should not happen.',
              })
              return
            }
            setTrainingResult({
              runId: winner.runId,
              algorithm: winner.algorithm as Algorithm,
              metrics: winner.metrics,
              trainedAt: job.finishedAt ?? job.createdAt,
              // A sweep job and CV are mutually exclusive (automl-toggles.tsx,
              // use-model-training.ts's own defense-in-depth refusal) — no
              // candidate here was ever a CV run.
              cvFoldsKey: null,
            })
            setCandidateJobId(job.id)
            setArtifactRef(null)
            setTrainState({ status: 'done', progress: 100 })
          } else {
            setTrainState({
              status: 'error',
              progress: 0,
              error:
                job.failureReason ??
                `Sweep ${job.status.toLowerCase()} with no reason recorded.`,
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
                : 'Lost connection while checking on the sweep.',
          })
        }
      }

      void tick()
      pollRef.current = setInterval(() => void tick(), POLL_MS)
    },
    [
      setArtifactRef,
      setCandidateJobId,
      setTrainState,
      setTrainingResult,
      stopPolling,
    ],
  )

  // Resume polling after a remount (Step 2 -> elsewhere -> Step 2) while a
  // run or job is still in flight server-side. Runs once on mount only —
  // this is a one-shot reconnect, not a subscription to every dependency
  // change. mpCandidateJobIdAtom is checked FIRST: it and trainState are
  // both in-memory jotai atoms in the same store, so if one survived a
  // remount the other did too, and a job in flight has no useful
  // ModelDraft.currentRunId yet (that field is only written at completion).
  useEffect(() => {
    if (trainState.status !== 'training') return
    if (pollRef.current) return
    if (!serverDraftId) return
    let cancelled = false
    void (async () => {
      try {
        if (candidateJobId) {
          runningRef.current = true
          pollJob(serverDraftId, candidateJobId)
          return
        }
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
      // MODEL-FLOW-013-T11 / [fix]. Find Best Parameters TUNES a winner —
      // either the sweep's (Find Best Model on) or, with exactly one
      // algorithm selected, that algorithm directly (a HYPERPARAMETER_SEARCH
      // job — no sweep needed, there is only one candidate). The UI already
      // disables the toggle for every other combination
      // (automl-toggles.tsx); this is defense in depth against stale draft
      // state from before that dependency existed.
      if (findBestParams && !findBestModel && algorithms.length !== 1) {
        throw new Error(
          'Find Best Parameters tunes the sweep’s winner — turn on Find Best Model too, or select exactly one algorithm to tune it directly.',
        )
      }
      // MODEL-FLOW-016. userDecisions: CV × algorithm sweep is mutually
      // exclusive — a CV run fits one algorithm's k folds, a sweep
      // evaluates several. The UI already disables Find Best Model while
      // CV is on (automl-toggles.tsx) and clears nSplits when a sweep
      // turns on (CvControl's own eligibility effect, core-config.tsx);
      // this is defense in depth against stale draft state from before
      // either dependency existed, same discipline the check above applies.
      if (nSplits !== undefined && findBestModel) {
        throw new Error(
          'Cross-Validation fits one algorithm — turn off Find Best Model, or turn off Cross-Validation to sweep.',
        )
      }

      const draftId = await ensureDraftId()
      if (!draftId) {
        throw new Error("Model draft isn't ready yet — check Step 1.")
      }

      // [fix]. Find Best Parameters with exactly one algorithm selected and
      // no sweep — a direct HYPERPARAMETER_SEARCH job. The client sends ONE
      // candidate (this algorithm's current/default hyperparameters); the
      // server expands it into the curated TUNING_GRID shortlist
      // (tuning-grid.ts, the same shortlist SWEEP_THEN_TUNE's phase 2
      // already uses) — the grid stays declared in exactly one place,
      // never duplicated client-side.
      if (findBestParams && !findBestModel) {
        const [algorithm] = algorithms
        if (algorithms.length !== 1 || !algorithm) {
          throw new Error(
            'Select exactly one algorithm to tune it directly, or turn on Find Best Model to sweep first.',
          )
        }
        const backendAlgorithm = toBackendAlgorithm(algorithm)
        if (!backendAlgorithm) {
          throw new Error(
            `"${ALGORITHM_LABELS[algorithm]}" isn't supported by the training service yet — pick another algorithm.`,
          )
        }

        const created = await modelDraftCandidateJobService.create(draftId, {
          goldArtifactId: selectedDataset.currentArtifactId,
          targetY,
          kind: 'HYPERPARAMETER_SEARCH',
          trainTestSplit: trainTestSplit / 100,
          candidates: [
            {
              algorithm: backendAlgorithm,
              hyperparameters: defaultHyperparams(algorithm),
            },
          ],
        })

        pollJob(draftId, created.data.id)
        return
      }

      if (findBestModel) {
        // MODEL-FLOW-013-T07/T11. Algorithm sweep — one candidate per
        // selected algorithm, its own clean defaults, RMSE decides the
        // winner. The job schema's own floor (.min(2)) is why 2 is required
        // here, not 1: a single-candidate "sweep" is just a normal run,
        // which createDraftRunService already exists for. Both toggles on
        // (SWEEP_THEN_TUNE) launches the SAME phase-1 candidates — phase 2
        // (tuning phase 1's winner) is appended server-side once phase 1
        // exhausts, never built client-side.
        if (algorithms.length < 2) {
          throw new Error(
            'Select at least 2 algorithms to sweep, or turn off Find Best Model.',
          )
        }
        const candidates = algorithms.map(a => {
          const backendAlgorithm = toBackendAlgorithm(a)
          if (!backendAlgorithm) {
            throw new Error(
              `"${ALGORITHM_LABELS[a]}" isn't supported by the training service yet — remove it from the sweep.`,
            )
          }
          return {
            algorithm: backendAlgorithm,
            hyperparameters: defaultHyperparams(a),
          }
        })

        const created = await modelDraftCandidateJobService.create(draftId, {
          goldArtifactId: selectedDataset.currentArtifactId,
          targetY,
          kind: findBestParams ? 'SWEEP_THEN_TUNE' : 'ALGORITHM_SWEEP',
          trainTestSplit: trainTestSplit / 100,
          candidates,
        })

        pollJob(draftId, created.data.id)
        return
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

      // A single-run launch — clear any PREVIOUS sweep's job id so Step 4
      // doesn't show a stale candidate table for this new, unrelated run.
      setCandidateJobId(null)

      const created = await modelDraftRunService.create(draftId, {
        goldArtifactId: selectedDataset.currentArtifactId,
        targetY,
        algorithm: backendAlgorithm,
        hyperparameters,
        // MODEL-FLOW-016-T10. EXACTLY ONE of the two, mirroring
        // CreateTrainingRunSchema's own .refine() server-side — sending
        // both would 400 a run the UI otherwise built correctly.
        // trainTestSplit is a FRACTION, never a percentage — converted
        // once, here, at the client boundary (same rule
        // useModelDraftSync's PATCH follows).
        ...(nSplits !== undefined
          ? { nSplits }
          : { trainTestSplit: trainTestSplit / 100 }),
        // MODEL-FLOW-014-T06. The Split Distribution panel's own tag
        // selection, so the frozen sidecar matches what was displayed.
        // Omitted (undefined) when the panel never seeded a selection —
        // the backend's own default is [targetY] either way.
        ...(splitStatsTags.length > 0 && { splitStatsTags }),
        // MODEL-FLOW-014-T07. Omitted when the user never set one — the
        // server generates its own random seed in that case. Undefined and
        // "explicitly 42" must stay distinguishable for reproducibility.
        ...(seed !== undefined && { seed }),
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
    nSplits,
    splitStatsTags,
    seed,
    ensureDraftId,
    pollRun,
    pollJob,
    setCandidateJobId,
    setTrainState,
  ])

  const reset = useCallback(() => {
    stopPolling()
    runningRef.current = false
    setTrainState({ status: 'idle', progress: 0 })
  }, [setTrainState, stopPolling])

  return { ...trainState, start: run, retry: run, reset }
}
