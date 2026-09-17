'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { inferenceWindowService } from '@/services/inference-window'

/**
 * MODEL-SERVE-011-T05/T08. One button, two planes.
 *
 * WINDOW PLANE: bypasses the wait for the scheduler's next tick (up to
 * INFERENCE_TICK_INTERVAL_MS away) and dispatches the latest fully-elapsed
 * window. A 202 means QUEUED — a container is being spawned; it does not
 * mean a prediction exists, and saying so would be the same optimistic
 * write MODEL-SERVE-001-T09 removed from `handleToggleDeploy`.
 *
 * LIVE PLANE: one warm /predict, which is what actually puts a point on the
 * Actual vs Predicted chart in the next few seconds. Its value is read from
 * the /predict RESPONSE, so the toast is true even when the background log
 * write is slow or sampled out.
 *
 * THE TWO ARE REPORTED SEPARATELY, NEVER MERGED. A quiet source can leave
 * the live half with no point while the window run is genuinely underway;
 * one sentence covering both would be wrong about one of them.
 *
 * Errors print the server's own text. This route refuses for distinct causes
 * (no schedule, a stopped schedule, no PRODUCTION version) and `fetchClient`
 * carries each message through unchanged.
 */
export interface UseRunPredictResult {
  runPredict: (modelId: string) => Promise<void>
  busy: boolean
}

/** The serving process writes PredictionLog from a FastAPI BackgroundTask
 *  that runs AFTER /predict has answered, so the row the chart reads can
 *  land a moment after this request resolves. One follow-up refetch covers
 *  that gap — deliberately a single late read, not a poll. */
const LOG_SETTLE_MS = 2_000

export function useRunPredict(onRan: () => void): UseRunPredictResult {
  const [busy, setBusy] = useState(false)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current)
    },
    [],
  )

  async function runPredict(modelId: string) {
    setBusy(true)
    try {
      const res = await inferenceWindowService.runNow(modelId)

      if (res.live.ok) {
        const at = new Date(res.live.at).toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
        })
        toast.success(
          `Predicted ${formatPrediction(res.live.predicted)} at ${at}`,
          {
            description: res.dispatched
              ? 'Window run queued — its results follow in a few minutes.'
              : res.message,
          },
        )
      } else {
        // NOT an error toast: the window half may be perfectly underway.
        // The reason is on screen rather than left to be inferred from a
        // chart that simply did not move (MODEL-SERVE-001-T26).
        toast.info(`No live reading — ${res.live.reason}`, {
          description: res.dispatched
            ? 'The window run was still queued.'
            : res.message,
        })
      }

      onRan()
      if (settleTimer.current) clearTimeout(settleTimer.current)
      settleTimer.current = setTimeout(onRan, LOG_SETTLE_MS)
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : 'Could not run a prediction.',
      )
    } finally {
      setBusy(false)
    }
  }

  return { runPredict, busy }
}

/** Enough digits to be a reading, not so many it reads as false precision —
 *  the same 2-decimal treatment the monitoring tooltip already gives a
 *  predicted value. */
function formatPrediction(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
