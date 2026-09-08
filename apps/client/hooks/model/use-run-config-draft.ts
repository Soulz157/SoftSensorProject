'use client'

import { useCallback, useState } from 'react'
import { useSetAtom } from 'jotai'
import {
  mpAcceptanceCriteriaAtom,
  mpAlgorithmAtom,
  mpAlgorithmsAtom,
  mpFindBestModelAtom,
  mpFindBestParamsAtom,
  mpHyperparamsAtom,
  mpPerAlgorithmHyperparamsAtom,
  mpLossFunctionAtom,
  mpSeedAtom,
  mpNSplitsAtom,
  mpTargetVariableAtom,
  mpTrainTestSplitAtom,
  type Algorithm,
  type HyperparamValue,
} from '@/store/model-pipeline'
import {
  criterionEqual,
  type AcceptanceCriterion,
} from '@/lib/acceptance-criteria'
import { defaultHyperparams } from '@/lib/training-config'
import { useCommitRunConfig } from './use-commit-run-config'
import type { UsePipelineNavResult } from './use-model-pipeline-nav'

export interface RunConfigDraft {
  algorithms: Algorithm[]
  findBestModel: boolean
  findBestParams: boolean
  targetVariables: string[]
  /** The PRIMARY algorithm's (`algorithms[0]`) values — derived from
   * `perAlgorithmHyperparameters` below, never stored separately. Kept as
   * its own field so every existing single-algorithm reader
   * (`phase-3-training-config.tsx`'s `showHyperparams` branch, the
   * single-run launch) needs no change. */
  hyperparameters: Record<string, HyperparamValue>
  /** MODEL-FLOW-022-T02. One entry per selected algorithm, INCLUDING the
   * primary — unlike `mpPerAlgorithmHyperparamsAtom`, which omits it. The
   * draft is the single place both are reconciled: `committedSnapshot`
   * below is the only composition step, so a value can never exist here
   * for an algorithm that isn't currently selected (AC2, for every one of
   * `mpAlgorithmsAtom`'s seven writers, not just `setAlgorithms`). */
  perAlgorithmHyperparameters: Partial<
    Record<Algorithm, Record<string, HyperparamValue>>
  >
  lossFunction: string
  trainTestSplit: number
  seed: number | undefined
  nSplits: number | undefined
  acceptanceCriteria: AcceptanceCriterion[]
}

function committedSnapshot(nav: UsePipelineNavResult): RunConfigDraft {
  const primary = nav.algorithms[0] ?? 'ols'
  // Prune to exactly the selected set, and let the flat atom win for the
  // primary — see `mpPerAlgorithmHyperparamsAtom`'s doc comment. This is
  // what makes AC2 hold for every `mpAlgorithmsAtom` writer at once,
  // including the four (Apply-from-RunParamsPanel, draft resume, preset,
  // edit-existing-model) that never go through `setAlgorithms`.
  const perAlgorithmHyperparameters = Object.fromEntries(
    nav.algorithms.map(a => [
      a,
      a === primary
        ? nav.hyperparameters
        : (nav.perAlgorithmHyperparameters[a] ?? defaultHyperparams(a)),
    ]),
  ) as Partial<Record<Algorithm, Record<string, HyperparamValue>>>

  return {
    algorithms: nav.algorithms,
    findBestModel: nav.findBestModel,
    findBestParams: nav.findBestParams,
    targetVariables: nav.targetVariables,
    hyperparameters: nav.hyperparameters,
    perAlgorithmHyperparameters,
    lossFunction: nav.lossFunction,
    trainTestSplit: nav.trainTestSplit,
    seed: nav.seed,
    nSplits: nav.nSplits,
    acceptanceCriteria: nav.acceptanceCriteria,
  }
}

function sameValues<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

function hyperparamsEqual(
  a: Record<string, HyperparamValue>,
  b: Record<string, HyperparamValue>,
): boolean {
  const aKeys = Object.keys(a)
  if (aKeys.length !== Object.keys(b).length) return false
  return aKeys.every(k => a[k] === b[k])
}

/** MODEL-FLOW-022-T02. Per-algorithm sibling of `hyperparamsEqual` above —
 * same shallow, order-insensitive discipline, one level deeper. Algorithm
 * keys come from `draft.algorithms`/`committedSnapshot`, which are always
 * built in the same order for a given selection, so key-set equality is
 * enough without a separate order check (mirrors `hyperparamsEqual`'s own
 * reasoning for its keys). */
function perAlgorithmHyperparamsEqual(
  a: Partial<Record<Algorithm, Record<string, HyperparamValue>>>,
  b: Partial<Record<Algorithm, Record<string, HyperparamValue>>>,
): boolean {
  const aKeys = Object.keys(a)
  if (aKeys.length !== Object.keys(b).length) return false
  return aKeys.every(k => {
    const av = a[k as Algorithm]
    const bv = b[k as Algorithm]
    if (!av || !bv) return av === bv
    return hyperparamsEqual(av, bv)
  })
}

/** Element-wise comparison, not reference equality — `sameValues<T>` above
 *  compares primitives by `===`, which a fresh `AcceptanceCriterion[]`
 *  array (a new object per element on every edit) would always fail even
 *  when its contents are unchanged. Order-sensitive: `setAcceptanceCriteria`
 *  is the only writer and always rebuilds in one fixed pair iteration
 *  order, so two equal drafts are never reordered relative to each other.
 *  MODEL-FLOW-019-T12 REPLACED T11's `{left, right, ratio}` with
 *  `{kind, left, operator, right} | {kind: 'r2-floor'}` — delegated to
 *  `criterionEqual` (canonicalised, so an operator-only edit that lands on
 *  the SAME criterion written the other way round is not mistaken for a
 *  change) rather than re-implemented here, or this dirty check would
 *  silently go stale again the next time the shape moves. */
function criteriaEqual(
  a: AcceptanceCriterion[],
  b: AcceptanceCriterion[],
): boolean {
  return (
    a.length === b.length &&
    a.every((c, i) => b[i] !== undefined && criterionEqual(c, b[i]))
  )
}

function draftsEqual(a: RunConfigDraft, b: RunConfigDraft): boolean {
  return (
    a.findBestModel === b.findBestModel &&
    a.findBestParams === b.findBestParams &&
    a.lossFunction === b.lossFunction &&
    a.trainTestSplit === b.trainTestSplit &&
    a.seed === b.seed &&
    a.nSplits === b.nSplits &&
    sameValues(a.algorithms, b.algorithms) &&
    sameValues(a.targetVariables, b.targetVariables) &&
    hyperparamsEqual(a.hyperparameters, b.hyperparameters) &&
    perAlgorithmHyperparamsEqual(
      a.perAlgorithmHyperparameters,
      b.perAlgorithmHyperparameters,
    ) &&
    criteriaEqual(a.acceptanceCriteria, b.acceptanceCriteria)
  )
}

export interface UseRunConfigDraftResult {
  draft: RunConfigDraft
  dirty: boolean
  setAlgorithms: (algorithms: Algorithm[]) => void
  setFindBestModel: (on: boolean) => void
  setFindBestParams: (on: boolean) => void
  setTargetVariable: (tags: string[]) => void
  setHyperparameter: (
    algorithm: Algorithm,
    key: string,
    value: HyperparamValue,
  ) => void
  setLossFunction: (loss: string) => void
  setTrainTestSplit: (split: number) => void
  setSeed: (seed: number | undefined) => void
  setNSplits: (nSplits: number | undefined) => void
  setAcceptanceCriteria: (criteria: AcceptanceCriterion[]) => void
  apply: () => void
  discard: () => void
}

export function useRunConfigDraft(
  nav: UsePipelineNavResult,
): UseRunConfigDraftResult {
  const [draft, setDraft] = useState<RunConfigDraft>(() =>
    committedSnapshot(nav),
  )
  // Tracks the committed SNAPSHOT `draft` was last synced FROM — not `nav`
  // itself. `useModelPipelineNav` returns a fresh object literal every
  // render, so storing `nav` would pin a stale *object* whose *fields*
  // only happen to be the right references today; a snapshot's own fields
  // are stable independent of `nav`'s object identity. A plain useEffect
  // re-seed here would fire an extra render pass for something React's own
  // docs cover directly ("Adjusting state when a prop changes"): compare
  // during render and call setState conditionally, which React applies
  // before painting rather than after a committed render. nav's array/
  // object fields are stable references between renders unless their own
  // atom was written (jotai), so this compares by reference cheaply and
  // does not fire on an unrelated re-render.
  const [syncedFrom, setSyncedFrom] = useState(() => committedSnapshot(nav))
  // MODEL-FLOW-022-T02. `committedSnapshot`'s `perAlgorithmHyperparameters`
  // is COMPOSED (pruned + primary-substituted via `Object.fromEntries`),
  // never the raw atom value itself — comparing `syncedFrom`'s composed
  // field against `nav.perAlgorithmHyperparameters` (the raw atom) would
  // therefore mismatch on EVERY render after the first re-seed, an infinite
  // loop. Tracked separately, against the raw reference, for that reason.
  const [syncedRawPerAlgorithm, setSyncedRawPerAlgorithm] = useState(
    () => nav.perAlgorithmHyperparameters,
  )
  if (
    syncedFrom.algorithms !== nav.algorithms ||
    syncedFrom.findBestModel !== nav.findBestModel ||
    syncedFrom.findBestParams !== nav.findBestParams ||
    syncedFrom.targetVariables !== nav.targetVariables ||
    syncedFrom.hyperparameters !== nav.hyperparameters ||
    syncedRawPerAlgorithm !== nav.perAlgorithmHyperparameters ||
    syncedFrom.lossFunction !== nav.lossFunction ||
    syncedFrom.trainTestSplit !== nav.trainTestSplit ||
    syncedFrom.seed !== nav.seed ||
    syncedFrom.nSplits !== nav.nSplits ||
    syncedFrom.acceptanceCriteria !== nav.acceptanceCriteria
  ) {
    const snapshot = committedSnapshot(nav)
    setSyncedFrom(snapshot)
    setSyncedRawPerAlgorithm(nav.perAlgorithmHyperparameters)
    setDraft(snapshot)
  }

  const dirty = !draftsEqual(draft, committedSnapshot(nav))

  const setAlgorithms = useCallback((algorithms: Algorithm[]) => {
    const capped = algorithms.slice(0, 3)
    const primary = capped[0] ?? 'ols'
    setDraft(prev => {
      // Prune to exactly the capped set. An algorithm that STAYS selected
      // keeps whatever it already had; a NEWLY ticked one is seeded from
      // its clean defaults; one no longer in `capped` has no entry at
      // all — AC2's discard falls out of the prune, it needs no separate
      // step. (Unlike the deleted single-algorithm cascade this replaces,
      // which reset to `defaultHyperparams(primary)` on ANY change and so
      // wiped every other algorithm's values on a third pick.)
      const perAlgorithmHyperparameters = Object.fromEntries(
        capped.map(a => [
          a,
          prev.perAlgorithmHyperparameters[a] ?? defaultHyperparams(a),
        ]),
      ) as Partial<Record<Algorithm, Record<string, HyperparamValue>>>
      return {
        ...prev,
        algorithms: capped,
        // Always re-derived from the pruned map above, never reset
        // independently — the two fields cannot desync because this is
        // the only place either is written together.
        hyperparameters:
          perAlgorithmHyperparameters[primary] ?? defaultHyperparams(primary),
        perAlgorithmHyperparameters,
      }
    })
  }, [])

  const setFindBestModel = useCallback((on: boolean) => {
    setDraft(prev => ({
      ...prev,
      findBestModel: on,
      // Mirrors the deleted nav.setFindBestModel cascade: Step B requires
      // Step A, so turning A off cascades B off in the draft too.
      findBestParams: on ? prev.findBestParams : false,
    }))
  }, [])

  const setFindBestParams = useCallback((on: boolean) => {
    setDraft(prev => ({ ...prev, findBestParams: on }))
  }, [])

  const setTargetVariable = useCallback((tags: string[]) => {
    setDraft(prev => ({ ...prev, targetVariables: tags }))
  }, [])

  const setHyperparameter = useCallback(
    (algorithm: Algorithm, key: string, value: HyperparamValue) => {
      setDraft(prev => {
        const primary = prev.algorithms[0] ?? 'ols'
        const nextForAlgorithm = {
          ...(prev.perAlgorithmHyperparameters[algorithm] ?? {}),
          [key]: value,
        }
        return {
          ...prev,
          // `hyperparameters` mirrors the primary's entry — written in the
          // same update as `perAlgorithmHyperparameters` below so the two
          // can never observe different values between renders.
          hyperparameters:
            algorithm === primary ? nextForAlgorithm : prev.hyperparameters,
          perAlgorithmHyperparameters: {
            ...prev.perAlgorithmHyperparameters,
            [algorithm]: nextForAlgorithm,
          },
        }
      })
    },
    [],
  )

  const setLossFunction = useCallback((loss: string) => {
    setDraft(prev => ({ ...prev, lossFunction: loss }))
  }, [])

  const setTrainTestSplit = useCallback((split: number) => {
    setDraft(prev => ({ ...prev, trainTestSplit: split }))
  }, [])

  const setSeed = useCallback((seed: number | undefined) => {
    setDraft(prev => ({ ...prev, seed }))
  }, [])

  const setNSplits = useCallback((nSplits: number | undefined) => {
    setDraft(prev => ({ ...prev, nSplits }))
  }, [])

  const setAcceptanceCriteria = useCallback(
    (acceptanceCriteria: AcceptanceCriterion[]) => {
      setDraft(prev => ({ ...prev, acceptanceCriteria }))
    },
    [],
  )

  const setAlgorithmsAtom = useSetAtom(mpAlgorithmsAtom)
  const setAlgorithmAtom = useSetAtom(mpAlgorithmAtom)
  const setFindBestModelAtom = useSetAtom(mpFindBestModelAtom)
  const setFindBestParamsAtom = useSetAtom(mpFindBestParamsAtom)
  const setTargetVariableAtom = useSetAtom(mpTargetVariableAtom)
  const setHyperparametersAtom = useSetAtom(mpHyperparamsAtom)
  const setPerAlgorithmHyperparametersAtom = useSetAtom(
    mpPerAlgorithmHyperparamsAtom,
  )
  const setLossFunctionAtom = useSetAtom(mpLossFunctionAtom)
  const setTrainTestSplitAtom = useSetAtom(mpTrainTestSplitAtom)
  const setSeedAtom = useSetAtom(mpSeedAtom)
  const setNSplitsAtom = useSetAtom(mpNSplitsAtom)
  const setAcceptanceCriteriaAtom = useSetAtom(mpAcceptanceCriteriaAtom)
  const commitRunConfig = useCommitRunConfig()

  const apply = useCallback(() => {
    const primary = draft.algorithms[0] ?? 'ols'
    setAlgorithmsAtom(draft.algorithms)
    setAlgorithmAtom(primary)
    setFindBestModelAtom(draft.findBestModel)
    setFindBestParamsAtom(draft.findBestParams)
    setTargetVariableAtom(draft.targetVariables)
    setHyperparametersAtom(draft.hyperparameters)
    // MODEL-FLOW-022-T02. The sibling atom EXCLUDES the primary — its own
    // entry is `draft.hyperparameters` above, the single source for it.
    // Committed alongside it, inside the same Apply, so relock still has
    // exactly one trigger (AC4).
    setPerAlgorithmHyperparametersAtom(
      Object.fromEntries(
        Object.entries(draft.perAlgorithmHyperparameters).filter(
          ([a]) => a !== primary,
        ),
      ) as Partial<Record<Algorithm, Record<string, HyperparamValue>>>,
    )
    setLossFunctionAtom(draft.lossFunction)
    setTrainTestSplitAtom(draft.trainTestSplit)
    setSeedAtom(draft.seed)
    setNSplitsAtom(draft.nSplits)
    // MODEL-FLOW-019-T07. Written here, alongside every other Core Config
    // field, so a threshold typed but not yet Applied stays exactly as
    // inert as an untyped seed value typed but not yet Applied — the
    // "evaluated INSIDE Apply, not on keystroke" rule falls out of this
    // shared boundary for free rather than needing its own mechanism.
    setAcceptanceCriteriaAtom(draft.acceptanceCriteria)
    commitRunConfig()
  }, [
    draft,
    setAlgorithmsAtom,
    setAlgorithmAtom,
    setFindBestModelAtom,
    setFindBestParamsAtom,
    setTargetVariableAtom,
    setHyperparametersAtom,
    setPerAlgorithmHyperparametersAtom,
    setLossFunctionAtom,
    setTrainTestSplitAtom,
    setSeedAtom,
    setNSplitsAtom,
    setAcceptanceCriteriaAtom,
    commitRunConfig,
  ])

  const discard = useCallback(() => {
    setDraft(committedSnapshot(nav))
    // committedSnapshot reads nav fresh each call; this is a point-in-time
    // revert, not a subscription — matches the render-time re-seed above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    nav.algorithms,
    nav.findBestModel,
    nav.findBestParams,
    nav.targetVariables,
    nav.hyperparameters,
    nav.perAlgorithmHyperparameters,
    nav.lossFunction,
    nav.trainTestSplit,
    nav.seed,
    nav.nSplits,
    nav.acceptanceCriteria,
  ])

  return {
    draft,
    dirty,
    setAlgorithms,
    setFindBestModel,
    setFindBestParams,
    setNSplits,
    setTargetVariable,
    setHyperparameter,
    setLossFunction,
    setTrainTestSplit,
    setSeed,
    setAcceptanceCriteria,
    apply,
    discard,
  }
}
