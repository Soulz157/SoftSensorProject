'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import {
  mpFineTuneBaseEditsAtom,
  mpFineTuneEnabledAtom,
  mpFineTuneSourceRunIdAtom,
  mpFineTuneUseGridAtom,
  mpLossFunctionAtom,
  mpServerDraftIdAtom,
  mpTrainStateAtom,
  type Algorithm,
  type HyperparamValue,
} from '@/store/model-pipeline'
import { useDraftRuns } from '@/hooks/model/use-draft-runs'
import { useExtraVariants } from '@/hooks/model/use-extra-variants'
import { useTuningVariantCounts } from '@/hooks/model/use-tuning-variant-counts'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'
import type { DatasetSize } from '@/lib/hyperparam-ranges'
import {
  fineTuneBaseFor,
  fineTuneBlockReason,
  fineTuneChoicesFor,
  type FineTuneChoice,
} from '@/lib/fine-tune'
import { isAlgorithm } from '@/lib/model-draft-hydration'
import { scoreMetricOf, type ScoreMetric } from '@/lib/run-params'
import {
  candidatesFor,
  planFineTuneLaunch,
  type FineTuneInput,
} from '@/lib/training-launch'
import type { ModelTrainingRunListItem } from '@/services/model-draft'

export interface UseFineTuneResult {
  /** At least one run has succeeded, so there is something to tune. */
  available: boolean
  /** The switch the user flips. Read `active` to decide what Start does. */
  enabled: boolean
  setEnabled: (on: boolean) => void
  /** `enabled` AND there is a run to tune: Start Training fine-tunes. */
  active: boolean
  metric: ScoreMetric
  /** The selector's cards: one per trained algorithm, its best run, best
   *  algorithm first. */
  choices: FineTuneChoice[]
  /** The best run by the Loss function — what the selector opens on. */
  defaultRunId: string | null
  source: ModelTrainingRunListItem | null
  setSourceRunId: (id: string) => void
  /** Edit one hyperparameter of the fine-tune's starting values (the open
   *  card's fields). Kept per run, laid over that run's own values. */
  setBaseValue: (key: string, value: HyperparamValue) => void
  /** False for a run of an algorithm no longer offered. */
  tunable: boolean
  algorithm: Algorithm
  base: Record<string, HyperparamValue>
  useGrid: boolean
  setUseGrid: (on: boolean) => void
  /** What Start Training sends while `active`. */
  input: FineTuneInput
  /** Why Start cannot fine-tune now (picked run, target/split, training), or
   *  the planner's own refusal; `null` when it can. Unapplied edits are left
   *  to the caller, which already says so for both rounds. */
  refusal: string | null
  /** Curated variants per algorithm, for the runtime estimate. */
  tuningVariants: Partial<Record<Algorithm, number>>
  /** Candidates when Find Best Parameters is off, for the runtime estimate. */
  candidatesPerAlgorithm: Partial<Record<Algorithm, number>> | undefined
}

/**
 * MODEL-FLOW-035 — the fine-tune (Round 2) state behind Step 3's single Start
 * button. The Fine-tune switch in the Algorithm & hyperparameters section
 * decides what Start does: off, Round 1 (every algorithm once); on, a
 * hyperparameter search over the run the user picked. One hook, so the panel
 * that edits it and the button that launches it can never disagree.
 */
export function useFineTune({
  nav,
  training,
  datasetSize,
}: {
  nav: UsePipelineNavResult
  /** A run or job is in flight. */
  training: boolean
  datasetSize: DatasetSize
}): UseFineTuneResult {
  const draftId = useAtomValue(mpServerDraftIdAtom)
  const { runs, refetch } = useDraftRuns(draftId)
  // `useDraftRuns` fetches once per draft and keeps its own copy, so without
  // this the list read on mount (often empty) is all this hook ever sees:
  // a run that finishes later never reaches it and Fine-tune stays
  // unavailable. Refetch on every train-state transition — the same rule
  // RunParamsPanel applies to its own copy.
  const trainStatus = useAtomValue(mpTrainStateAtom).status
  useEffect(() => {
    refetch()
  }, [trainStatus, refetch])
  const metric = scoreMetricOf(useAtomValue(mpLossFunctionAtom))
  const [enabled, setEnabled] = useAtom(mpFineTuneEnabledAtom)
  const [chosenId, setSourceRunId] = useAtom(mpFineTuneSourceRunIdAtom)
  const [useGrid, setUseGrid] = useAtom(mpFineTuneUseGridAtom)
  const [baseEdits, setBaseEdits] = useAtom(mpFineTuneBaseEditsAtom)

  const choices = useMemo(
    () => fineTuneChoicesFor(runs, metric),
    [runs, metric],
  )
  const defaultRunId = choices[0]?.run.id ?? null
  // A stale id (another draft, a deleted run, or a run that is no longer its
  // algorithm's best) falls back to the best run.
  const source =
    choices.find(c => c.run.id === chosenId)?.run ?? choices[0]?.run ?? null

  const tunable = source !== null && isAlgorithm(source.algorithm)
  const algorithm: Algorithm = tunable ? (source.algorithm as Algorithm) : 'ols'
  const rows = useExtraVariants(algorithm).variants
  const edits = source ? baseEdits[source.id] : undefined
  const base = useMemo(
    () => (source ? { ...fineTuneBaseFor(algorithm, source), ...edits } : {}),
    [algorithm, source, edits],
  )
  const sourceRunId = source?.id ?? null
  const setBaseValue = useCallback(
    (key: string, value: HyperparamValue) => {
      if (!sourceRunId) return
      setBaseEdits(prev => ({
        ...prev,
        [sourceRunId]: { ...prev[sourceRunId], [key]: value },
      }))
    },
    [sourceRunId, setBaseEdits],
  )

  const available = choices.length > 0
  const active = enabled && source !== null

  const tuningVariants = useTuningVariantCounts({
    enabled: active && useGrid && tunable,
    algorithms: [algorithm],
    hyperparameters: base,
    perAlgorithmHyperparameters: {},
    extraVariants: { [algorithm]: rows },
    size: datasetSize,
  })

  const input = useMemo<FineTuneInput>(
    () => ({ algorithm, base, rows, useGrid }),
    [algorithm, base, rows, useGrid],
  )

  const planError = useMemo(() => {
    try {
      planFineTuneLaunch(input)
      return null
    } catch (err) {
      return err instanceof Error ? err.message : 'These settings cannot start.'
    }
  }, [input])

  const [targetY] = nav.targetVariables
  const refusal = !source
    ? null
    : !tunable
      ? `${source.algorithm} is no longer offered, so this run cannot be fine-tuned.`
      : (fineTuneBlockReason(source, {
          targetY: targetY ?? null,
          trainTestSplit: nav.trainTestSplit,
          nSplits: nav.nSplits,
          dirty: false,
          training,
        }) ?? planError)

  return {
    available,
    enabled,
    setEnabled,
    active,
    metric,
    choices,
    defaultRunId,
    source,
    setSourceRunId,
    setBaseValue,
    tunable,
    algorithm,
    base,
    useGrid,
    setUseGrid,
    input,
    refusal,
    tuningVariants,
    candidatesPerAlgorithm: useGrid
      ? undefined
      : { [algorithm]: candidatesFor(algorithm, base, rows).length },
  }
}
