'use client'

import { useLabEventCount } from '@/hooks/model/use-lab-event-count'
import { labEventSource } from '@/lib/retrain-lab-events'
import type { EvalBasis } from '@/services/model-retrain'

export interface LabEventIds {
  modelId: string
  candidateRunId: string | null
  incumbentSourceRunId: string | null
}

/**
 * MODEL-SERVE-026-T02. Appended to a figure's basis line: how many LAB EVENTS
 * its rows carry, beside — never instead of — the row count the basis line
 * already states. A row is not an observation here: a lab value is held
 * across many rows, so "744 rows" can rest on ~32 measurements.
 */
export function BasisLabEvents({
  basis,
  role,
  ids,
}: {
  basis: EvalBasis
  role: 'candidate' | 'incumbent'
  ids: LabEventIds
}) {
  const count = useLabEventCount(ids.modelId, labEventSource(basis, role, ids))
  if (count.status === 'loading') return <> · counting lab events…</>
  if (count.status === 'unavailable')
    return <> · lab events unavailable ({count.reason})</>
  return (
    <span title="A lab event is a held value, counted once where it starts. A one-row value between two held values is an hourly blend and is not counted; a lab value held for only one row is skipped the same way.">
      {' · '}
      {count.events.toLocaleString()} lab event{count.events === 1 ? '' : 's'}
    </span>
  )
}
