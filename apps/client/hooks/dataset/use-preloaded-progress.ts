'use client'

import { useEffect, useState } from 'react'
import { preloadProgress } from '@/lib/dataset-fetch'

/** Pause before the bar runs ahead, so a fast batch lands before the bar
 * has claimed anything it did not do. */
export const PRELOAD_DELAY_MS = 500

interface Args {
  /** True while a fetch is running. */
  active: boolean
  /** Real progress, 0–100, moved only when a batch lands. */
  progress: number
  completedBatches: number
  totalBatches: number
  /** The run's start stamp. A new run must not inherit the last one's
   * preload, so the preload is keyed by it. */
  runStartedAt: number | null
}

/**
 * The progress the Step 2 bar SHOWS. Real progress only moves when a batch
 * lands, so a one-batch fetch sat at 0% until it jumped to 100% and read as
 * stuck. `PRELOAD_DELAY_MS` after each step starts, the bar runs ahead to
 * `preloadProgress` (66% of the batches in flight, never past 99); the
 * Progress bar's own transition animates the move.
 *
 * Never goes backwards within a run: when a batch lands below what was
 * already shown, the bar holds instead of stepping back. When the run is not
 * active this returns real progress untouched, so done reads 100 and an
 * error or cancel reads what actually landed.
 */
export function usePreloadedProgress({
  active,
  progress,
  completedBatches,
  totalBatches,
  runStartedAt,
}: Args): number {
  const [preload, setPreload] = useState<{
    run: number | null
    value: number
  } | null>(null)

  useEffect(() => {
    if (!active) return
    const target = preloadProgress(completedBatches, totalBatches)
    const timer = setTimeout(
      () =>
        setPreload(prev => ({
          run: runStartedAt,
          value:
            prev && prev.run === runStartedAt
              ? Math.max(prev.value, target)
              : target,
        })),
      PRELOAD_DELAY_MS,
    )
    return () => clearTimeout(timer)
  }, [active, completedBatches, totalBatches, runStartedAt])

  if (!active) return progress
  const ahead = preload && preload.run === runStartedAt ? preload.value : 0
  return Math.max(progress, ahead)
}
