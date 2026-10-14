'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  modelDraftRunService,
  modelDraftCandidateJobService,
  modelDraftService,
  type CreateDraftRunInput,
  type ModelCandidateJob,
} from '@/services/model-draft'
import type { DraftSplitStatsResult } from '@/services/dataset-version'
import { datasetSizeFrom } from '@/lib/hyperparam-ranges'
import { baseHyperparamsFor } from '@/lib/tuning-preview'
import { planTrainingLaunch } from '@/lib/training-launch'
import { isSequenceAlgorithm } from '@/lib/metric-source'
import {
  mpTrainStateAtom,
  mpServerDraftIdAtom,
  mpTargetVariableAtom,
  mpAlgorithmsAtom,
  mpFindBestParamsAtom,
  mpHyperparamsAtom,
  mpPerAlgorithmHyperparamsAtom,
  mpExtraVariantsAtom,
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
  type HyperparamValue,
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
  /**
   * MODEL-FLOW-020-T04/T02. The `/split-stats` result Step 3 has ALREADY
   * fetched, passed in rather than re-read here: the two size figures a
   * candidate job records come off it, and this hook must not make a second
   * call for them — the whole reason they are captured client-side is that
   * `distinct_labelled_values` costs a full artifact read the launch path
   * deliberately refuses.
   *
   * A DEP, NOT AN ATOM, unlike every other input this hook reads: these are
   * the RESPONSE to a fetch the parent owns, not wizard state the user set.
   * Putting them in an `mp*` atom would make a server response look like
   * config that survives a draft resume, which it is not.
   *
   * `null` whenever that fetch has not resolved — no Apply yet, a sequence
   * algorithm selected (the parent declines to fetch for lstm/gru), or still
   * in flight. The job then records the dataset's own row count alone (see
   * `sizedFigures`), never a distinct count it cannot supply.
   */
  splitStats: Pick<
    DraftSplitStatsResult,
    'source_rows' | 'distinct_labelled_values'
  > | null
}

/**
 * CORRECTED — this used to refuse lstm/gru unconditionally, on the claim
 * that train.py's `build_model` implemented only 10 of the wizard's 12
 * catalogue entries. That shipped before MODEL-FLOW-009-T04 landed the
 * windowing pipeline; `build_model` (images/trainer/app/models.py) builds a
 * real `SequenceRegressor` for both now, and a plain single run trains them
 * live (MODEL-FLOW-023-T10's own verify script) — this function was the
 * reason the wizard could not reach that path at all.
 *
 * CORRECTED AGAIN (MODEL-FLOW-024). `forSweep` is the ONE place the refusal
 * is still real, and it is a scope decision, not a backend limit. This
 * comment used to say model-candidate-job.authorized.service.ts 400s a
 * sequence-algorithm candidate outright; it does not — that file never
 * mentions lstm/gru, `CandidateSchema.algorithm` accepts both, and the only
 * explicit refusal (model-run-launch) is for a CV run. What actually 400ed a
 * direct HYPERPARAMETER_SEARCH was `expandSearchCandidates` finding NO
 * `TUNING_GRID` entry, which MODEL-FLOW-024 added. A direct Find Best
 * Parameters on one lstm/gru is therefore allowed. A SWEEP (two or more algorithms,
 * with or without tuning) still refuses them: it would launch up to three
 * sequence fits before any tuning, and whether it should is an open decision
 * on MODEL-FLOW-024, not something to enable by accident. `null` here is this
 * function's own backstop for that case (MODEL-FLOW-003-T10's original
 * discipline: refuse client-side rather than send it and let the service
 * fail), kept as defense in depth against stale draft state — same pattern
 * the oversized-dataset checks already use.
 */
function toBackendAlgorithm(
  algorithm: Algorithm,
  forSweep: boolean,
): CreateDraftRunInput['algorithm'] | null {
  if (forSweep && isSequenceAlgorithm(algorithm)) {
    return null
  }
  return algorithm
}

/**
 * Phase-2 training driver (MODEL-FLOW-003). Creates a run against the
 * server-side ModelDraft and polls it to completion — no Model row, no
 * `useModelCommit()` call. That commit path is Step 4's alone now; calling
 * it from here was the exact violation this feature removes (see T03).
 */
export function useModelTraining({
  ensureDraftId,
  splitStats,
}: Deps): UseModelTrainingResult {
  const [trainState, setTrainState] = useAtom(mpTrainStateAtom)
  const serverDraftId = useAtomValue(mpServerDraftIdAtom)
  const targetVariables = useAtomValue(mpTargetVariableAtom)
  const algorithms = useAtomValue(mpAlgorithmsAtom)
  const findBestParams = useAtomValue(mpFindBestParamsAtom)
  const hyperparameters = useAtomValue(mpHyperparamsAtom)
  const perAlgorithmHyperparameters = useAtomValue(
    mpPerAlgorithmHyperparamsAtom,
  )
  const extraVariants = useAtomValue(mpExtraVariantsAtom)
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

  /**
   * MODEL-FLOW-020-T04. The two size figures a candidate job records, shaped
   * once here and spread into all three job-creating calls below rather than
   * re-derived at each — the sweep, the direct search and SWEEP_THEN_TUNE
   * must record the same thing, and three copies of `?? undefined` is how
   * they would eventually stop doing so.
   *
   * The rows figure picks the tuning grid's size tier, so it comes from
   * `datasetSizeFrom` — the SAME rule the Step 3 form sizes its ranges with
   * (`/split-stats` `source_rows`, else the dataset's own row count) — and the
   * ranges the form shows cannot disagree with the variants a search tries,
   * before Apply or for lstm/gru, which never fetch split stats. The distinct
   * count exists only with the fetch and is sent beside it for the record;
   * the server's schema refuses it WITHOUT rows, which this cannot produce.
   */
  const sizedFigures = useMemo(() => {
    const size = datasetSizeFrom(splitStats, selectedDataset?.rowCount)
    return {
      ...(size.rows != null ? { sizedRowCount: size.rows } : {}),
      ...(size.distinctLabelled != null
        ? { sizedDistinctLabelled: size.distinctLabelled }
        : {}),
    }
  }, [splitStats, selectedDataset?.rowCount])

  /**
   * MODEL-FLOW-022-T04. `mpPerAlgorithmHyperparamsAtom` deliberately omits
   * the primary algorithm (`mpHyperparamsAtom` is its single source, see
   * that atom's own doc comment) — so a candidate builder that only checked
   * the sibling atom would send `{}` for whichever algorithm is primary.
   * Mirrors `committedSnapshot`'s own composition in `use-run-config-draft.ts`.
   *
   * The primary falls back to `defaultHyperparams` too, when its flat atom
   * is still at its virgin `{}` (`mpHyperparamsAtom`'s own default,
   * store/model-pipeline.ts) — unreachable once the wizard has run through
   * `resetPipeline`/`resetWizardAtom`, both of which seed it before Step 3
   * is ever reachable, but kept as the same defense-in-depth every other
   * algorithm entry already gets, not a special case for this one.
   */
  // MODEL-FLOW-025. The rule itself lives in `lib/tuning-preview.ts`, so Step
  // 3's variant preview computes the very base this launch sends — a Find Best
  // Parameters search excludes variants against it, and a second copy of the
  // rule here would let the preview and the job disagree.
  const hyperparametersFor = useCallback(
    (algorithm: Algorithm): Record<string, HyperparamValue> =>
      baseHyperparamsFor(
        algorithm,
        algorithms,
        hyperparameters,
        perAlgorithmHyperparameters,
      ),
    [algorithms, hyperparameters, perAlgorithmHyperparameters],
  )

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
      // What to launch is decided by `planTrainingLaunch` alone (user decision
      // 2026-10-14: training every selected algorithm and every added row is
      // the default, Find Best Model is gone, Find Best Parameters only adds
      // the curated grid). It throws the refusals the controls already
      // prevent — CV or LSTM/GRU beside another algorithm, more than 20
      // candidates — so stale draft state still cannot reach the server.
      const plan = planTrainingLaunch({
        algorithms,
        baseFor: hyperparametersFor,
        extraVariants,
        findBestParams,
        nSplits,
      })

      const draftId = await ensureDraftId()
      if (!draftId) {
        throw new Error("Model draft isn't ready yet — check Step 1.")
      }

      if (plan.type === 'job') {
        // A sweep refuses LSTM/GRU (scope decision, MODEL-FLOW-024); a
        // one-algorithm search may tune one.
        const forSweep = plan.kind !== 'HYPERPARAMETER_SEARCH'
        const candidates = plan.candidates.map(c => {
          const backendAlgorithm = toBackendAlgorithm(c.algorithm, forSweep)
          if (!backendAlgorithm) {
            throw new Error(
              `"${ALGORITHM_LABELS[c.algorithm]}" isn't supported by the training service yet — remove it.`,
            )
          }
          return {
            algorithm: backendAlgorithm,
            hyperparameters: c.hyperparameters,
          }
        })
        const created = await modelDraftCandidateJobService.create(draftId, {
          goldArtifactId: selectedDataset.currentArtifactId,
          targetY,
          kind: plan.kind,
          // MODEL-FLOW-029. EXACTLY ONE of the two. Only a one-algorithm
          // search can be cross-validated; `planTrainingLaunch` has already
          // refused CV for every other kind.
          ...(nSplits !== undefined && plan.kind === 'HYPERPARAMETER_SEARCH'
            ? { nSplits }
            : { trainTestSplit: trainTestSplit / 100 }),
          candidates,
          // MODEL-FLOW-026. Only a grid search on one algorithm carries them
          // separately; everywhere else the rows are already candidates.
          ...(plan.extraVariants ? { extraVariants: plan.extraVariants } : {}),
          ...sizedFigures,
        })

        pollJob(draftId, created.data.id)
        return
      }

      const { algorithm } = plan.candidate
      const backendAlgorithm = toBackendAlgorithm(algorithm, false)
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
    findBestParams,
    algorithms,
    hyperparameters,
    // MODEL-FLOW-026. Without this the callback closes over the rows as they
    // were when the algorithm list last changed, so a variant added just
    // before Start Training would silently not be sent.
    extraVariants,
    hyperparametersFor,
    trainTestSplit,
    nSplits,
    splitStatsTags,
    seed,
    sizedFigures,
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
