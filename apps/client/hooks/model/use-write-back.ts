'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import {
  modelEvaluationService,
  type EvaluationCompareResult,
  type WriteBackConfigView,
  type WriteBackDryRun,
  type WriteBackKind,
} from '@/services/model-backfill'
import type { LabRow } from '@/lib/backfill-lab'
import { pointsFor, writeBlocker } from '@/lib/backfill-write-back'

export interface UseWriteBack {
  /** Why `kind` cannot be written right now; null when it can. */
  blockerFor: (kind: WriteBackKind) => string | null
  /** The dry run the user is being asked to confirm; null = no dialog. */
  pending: WriteBackDryRun | null
  /** A dry run is in flight for this kind. */
  preparing: WriteBackKind | null
  writing: boolean
  /** Ask the server what a write WOULD do, then open the confirm dialog. */
  prepare: (kind: WriteBackKind) => Promise<void>
  /** Do the write the open dialog describes. */
  confirm: () => Promise<void>
  cancel: () => void
}

function message(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

/**
 * MODEL-SERVE-032. dry run -> confirm -> write.
 *
 * Nothing is written until `confirm`, and `confirm` re-sends the same points
 * the dry run described. The destination tag is never sent: the server takes
 * it from the saved config.
 *
 * The result is reported as what it was. A PARTIAL or FAILED batch is NOT a
 * success toast: the batch is recorded either way (and can be rolled back),
 * and saying "written" over a batch PI half-took is the optimistic write this
 * code is here to avoid.
 */
export function useWriteBack(args: {
  modelId: string
  data: EvaluationCompareResult | null
  rows: readonly LabRow[]
  view: WriteBackConfigView | null
  onWritten: () => void
}): UseWriteBack {
  const { modelId, data, rows, view, onWritten } = args
  const [pending, setPending] = useState<WriteBackDryRun | null>(null)
  const [preparing, setPreparing] = useState<WriteBackKind | null>(null)
  const [writing, setWriting] = useState(false)

  const blockerFor = useCallback(
    (kind: WriteBackKind) => writeBlocker({ kind, view, data, rows }),
    [view, data, rows],
  )

  const body = useCallback(
    (kind: WriteBackKind, dryRun: boolean) => ({
      kind,
      points: data ? pointsFor(kind, data, rows) : [],
      ...(kind === 'PREDICTION' && data
        ? { modelVersionId: data.modelVersionId }
        : {}),
      dryRun,
    }),
    [data, rows],
  )

  const prepare = useCallback(
    async (kind: WriteBackKind) => {
      if (blockerFor(kind)) return
      setPreparing(kind)
      try {
        const res = await modelEvaluationService.writeBack(
          modelId,
          body(kind, true),
        )
        if (res.dryRun) setPending(res)
      } catch (err) {
        toast.error(message(err, 'Could not check this write.'))
      } finally {
        setPreparing(null)
      }
    },
    [modelId, body, blockerFor],
  )

  const confirm = useCallback(async () => {
    if (!pending) return
    setWriting(true)
    try {
      const res = await modelEvaluationService.writeBack(
        modelId,
        body(pending.kind, false),
      )
      if (!res.dryRun) {
        const b = res.batch
        if (b.status === 'SUCCEEDED') {
          toast.success(`Wrote ${b.okCount} points to ${b.tag}`, {
            description: 'The previous values are kept and can be rolled back.',
          })
        } else {
          toast.error(
            `${b.status === 'PARTIAL' ? 'Partly written' : 'Not written'}: ${b.okCount} of ${b.pointCount} points verified in PI`,
            {
              description:
                b.error ??
                'See the write history for each point. It can be rolled back.',
            },
          )
        }
        onWritten()
      }
      setPending(null)
    } catch (err) {
      toast.error(message(err, 'The write failed.'))
    } finally {
      setWriting(false)
    }
  }, [modelId, pending, body, onWritten])

  const cancel = useCallback(() => setPending(null), [])

  return { blockerFor, pending, preparing, writing, prepare, confirm, cancel }
}
