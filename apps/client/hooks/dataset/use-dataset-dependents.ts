'use client'

import { useEffect, useState } from 'react'
import { datasetService, type DatasetDependentModel } from '@/services/dataset'

export type DependentsState = 'idle' | 'loading' | 'ready' | 'error'

/**
 * DS-LAKE-030-T02. The models that would be affected by deleting
 * `datasetId`, fetched when the confirm dialog opens.
 *
 * FETCHED ON OPEN, NOT PER ROW. The dataset list can hold dozens of cards
 * and a dependents lookup is two indexed reads per dataset — prefetching all
 * of them to fill a dialog the user opens once would pay that cost for
 * nothing. `datasetId` is null while no dialog is open, which is what keeps
 * this idle.
 *
 * A FAILED LOOKUP NEVER BLOCKS THE DELETE. The list is advisory (D01), so
 * `error` renders as "could not check" beside a still-enabled Delete rather
 * than as a refusal — an unreachable backend must not become a soft lock on
 * a destructive action the user is entitled to take.
 *
 * BOTH RESULTS ARE KEYED BY THE ID THEY CAME FROM, and the returned state is
 * DERIVED from comparing that key to the current `datasetId`. The obvious
 * shape — setState('loading') and setState([]) at the top of the effect —
 * writes state synchronously during the effect body on every open, which
 * cascades a second render and trips `react-hooks/set-state-in-effect`.
 * Keying does the same job for free: a stale id simply fails the comparison
 * and reads as `loading`, which is also what makes reopening the dialog on a
 * DIFFERENT dataset impossible to render under the previous one's answer.
 */
export function useDatasetDependents(datasetId: string | null) {
  const [result, setResult] = useState<{
    id: string
    models: DatasetDependentModel[]
  } | null>(null)
  const [failedId, setFailedId] = useState<string | null>(null)

  useEffect(() => {
    if (!datasetId) return

    // Guards the RESPONSE, not the request: without it a slow lookup for a
    // dialog the user already closed would still land in state.
    let active = true
    datasetService
      .dependents(datasetId)
      .then(res => {
        if (active) setResult({ id: datasetId, models: res.data.models })
      })
      .catch(() => {
        if (active) setFailedId(datasetId)
      })

    return () => {
      active = false
    }
  }, [datasetId])

  const state: DependentsState = !datasetId
    ? 'idle'
    : result?.id === datasetId
      ? 'ready'
      : failedId === datasetId
        ? 'error'
        : 'loading'

  return {
    models: state === 'ready' && result ? result.models : [],
    state,
  }
}
