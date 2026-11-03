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
 * SEQUENCE MODELS (lstm/gru): Serving cannot score them, so the server
 * answers `liveVia: 'window'` and this hook polls the window it dispatched
 * until it lands, then shows the SAME "Predicted X at …" toast. One button,
 * one message, every algorithm; only the wait and the time (the last full
 * hour, not this minute) differ.
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

/** lstm/gru only: how often to ask whether the dispatched window has a
 *  value yet, and when to stop asking. A window run is a container spawn
 *  (seconds), so a few minutes is generous; past it the value still lands
 *  on the chart, it just is not announced. */
const WINDOW_POLL_MS = 3_000
const WINDOW_POLL_LIMIT_MS = 5 * 60_000

export function useRunPredict(onRan: () => void): UseRunPredictResult {
  const [busy, setBusy] = useState(false)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unmounted = useRef(false)

  useEffect(
    () => () => {
      unmounted.current = true
      if (settleTimer.current) clearTimeout(settleTimer.current)
    },
    [],
  )

  async function runPredict(modelId: string) {
    setBusy(true)
    try {
      const res = await inferenceWindowService.runNow(modelId)

      if (res.liveVia === 'window') {
        await announceFromWindow(modelId, res.windowId, () => unmounted.current)
      } else if (res.live.ok) {
        toast.success(
          `Predicted ${formatPrediction(res.live.predicted)} at ${clock(res.live.at)}`,
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

/** lstm/gru: Serving cannot score a sequence model, so the press reports
 *  the window it dispatched. Same toast as a served press once it lands; the
 *  server reads the value and records the chart point itself. Module-level
 *  (not inside the hook) so the clock reads stay out of render. */
async function announceFromWindow(
  modelId: string,
  windowId: string,
  isCancelled: () => boolean,
): Promise<void> {
  const toastId = toast.loading('Scoring the latest hour…', {
    description:
      'This model is scored through its hourly window; the value follows in a few seconds.',
  })
  const deadline = Date.now() + WINDOW_POLL_LIMIT_MS
  try {
    while (!isCancelled()) {
      const poll = await inferenceWindowService.windowPrediction(
        modelId,
        windowId,
      )
      if (!poll.pending) {
        if (poll.live.ok) {
          toast.success(
            `Predicted ${formatPrediction(poll.live.predicted)} at ${clock(poll.live.at)}`,
            { id: toastId, description: 'From the latest hourly window.' },
          )
        } else {
          toast.info(`No reading — ${poll.live.reason}`, { id: toastId })
        }
        return
      }
      if (Date.now() >= deadline) {
        toast.info('Still scoring', {
          id: toastId,
          description:
            'The value will appear on the chart when the window finishes.',
        })
        return
      }
      await new Promise(resolve => setTimeout(resolve, WINDOW_POLL_MS))
    }
    toast.dismiss(toastId)
  } catch (err) {
    toast.error(
      err instanceof Error && err.message
        ? err.message
        : 'Could not read the window prediction.',
      { id: toastId },
    )
  }
}

/** The scored row's own time, hour:minute in the viewer's locale. */
function clock(at: string): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })
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
