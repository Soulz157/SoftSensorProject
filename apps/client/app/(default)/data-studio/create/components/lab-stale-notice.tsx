'use client'

import { useMemo } from 'react'
import { Clock } from 'lucide-react'
import { labStaleNotices } from '@/lib/data-quality'
import type { Dataset } from '@/lib/preprocessing'

interface Props {
  dataset: Dataset
  /** Set when `dataset` is a bounded page rather than the whole frame, so the
   *  notice never claims more than it looked at. */
  scopeNote?: string
}

/**
 * Lab values that stopped changing for far longer than usual — a sampler that
 * stopped reporting, with the last value carried forward and stamped Good.
 * A heads-up only: muted text, no status colour, and nothing is removed (the
 * user decides). The rule lives in `labStaleRuns` (lib/data-quality.ts).
 */
export function LabStaleNotice({ dataset, scopeNote }: Props) {
  const lines = useMemo(() => labStaleNotices(dataset), [dataset])
  if (lines.length === 0) return null
  return (
    <div className="space-y-1 rounded-lg border border-border p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
        Lab values held unusually long
      </p>
      <ul className="space-y-0.5">
        {lines.map(line => (
          <li key={line} className="text-[11px] text-muted-foreground">
            {line}
          </li>
        ))}
      </ul>
      {scopeNote && (
        <p className="text-[10px] text-muted-foreground">{scopeNote}</p>
      )}
    </div>
  )
}
