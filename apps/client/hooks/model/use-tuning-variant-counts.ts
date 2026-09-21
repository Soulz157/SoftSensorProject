'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  tuningGridService,
  type TuningGridResponse,
} from '@/services/tuning-grid'
import type { Algorithm, HyperparamValue } from '@/store/model-pipeline'
import type { DatasetSize } from '@/lib/hyperparam-ranges'
import { baseHyperparamsFor, previewVariants } from '@/lib/tuning-preview'

/**
 * MODEL-FLOW-025-T06. How many variants Find Best Parameters would run for EACH
 * selected algorithm — the same count the per-card preview shows — so the
 * runtime estimate prices the search it will actually launch rather than the
 * cap. Fetches each algorithm's grid once per algorithm and size; the count is
 * then recomputed from the base on every edit, with no request.
 *
 * `{}` while disabled, loading, or for an algorithm whose grid failed: the
 * estimate falls back to the cap there, which over- rather than
 * under-estimates.
 */
export function useTuningVariantCounts({
  enabled,
  algorithms,
  hyperparameters,
  perAlgorithmHyperparameters,
  size,
}: {
  enabled: boolean
  algorithms: Algorithm[]
  hyperparameters: Record<string, HyperparamValue>
  perAlgorithmHyperparameters: Partial<
    Record<Algorithm, Record<string, HyperparamValue>>
  >
  size: DatasetSize | undefined
}): Partial<Record<Algorithm, number>> {
  // Grids are stored WITH the key they were fetched for, and read only while
  // that key is current — so a size or selection change hides the old grids
  // at once without a synchronous reset inside the effect.
  const [fetched, setFetched] = useState<{
    key: string
    grids: Partial<Record<Algorithm, TuningGridResponse>>
  } | null>(null)

  const rows = size?.rows ?? null
  const features = size?.features ?? null
  const key = enabled ? `${algorithms.join(',')}|${rows}|${features}` : null

  useEffect(() => {
    if (!key) return
    let cancelled = false
    const requestSize: DatasetSize = { rows, features }
    Promise.all(
      algorithms.map(a =>
        tuningGridService
          .get(a, requestSize)
          .then(grid => [a, grid] as const)
          .catch(() => null),
      ),
    ).then(results => {
      if (cancelled) return
      const next: Partial<Record<Algorithm, TuningGridResponse>> = {}
      for (const r of results) if (r) next[r[0]] = r[1]
      setFetched({ key, grids: next })
    })
    return () => {
      cancelled = true
    }
    // `key` encodes every request-determining input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return useMemo(() => {
    if (!enabled || !fetched || fetched.key !== key) return {}
    const grids = fetched.grids
    const counts: Partial<Record<Algorithm, number>> = {}
    for (const a of algorithms) {
      const grid = grids[a]
      if (!grid) continue
      counts[a] = previewVariants(
        a,
        grid.variants,
        baseHyperparamsFor(
          a,
          algorithms,
          hyperparameters,
          perAlgorithmHyperparameters,
        ),
        grid.maxVariantsPerJob,
      ).shown.length
    }
    return counts
  }, [
    enabled,
    algorithms,
    fetched,
    key,
    hyperparameters,
    perAlgorithmHyperparameters,
  ])
}
