'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import {
  modelEvaluationService,
  type RollbackDryRun,
  type WriteBackHistoryItem,
} from '@/services/model-evaluation'
import { canRollbackNow } from '@/lib/evaluation-history'

export interface UseRollback {
  /** The batch the dialog is about; null = dialog closed. */
  target: WriteBackHistoryItem | null
  /** The server's dry run for `target`; null while it is being asked. */
  plan: RollbackDryRun | null
  checking: boolean
  rolling: boolean
  force: boolean
  /** The server's own sentence for a refusal, shown inside the dialog. */
  error: string | null
  canProceed: boolean
  prepare: (batch: WriteBackHistoryItem) => Promise<void>
  setForce: (force: boolean) => void
  confirm: () => Promise<void>
  cancel: () => void
}

function message(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

/**
 * MODEL-SERVE-032. dry run -> confirm -> roll back.
 *
 * The dry run reports a later overlapping write (which blocks, never
 * overridable) and points PI no longer holds as written (drift, which only
 * `force` overrides). A refusal on the real call (state changed since the
 * dry run) stays inside the dialog as the server's sentence. A rollback that
 * PI only half-took is reported as an error, not as success.
 */
export function useRollback(args: {
  modelId: string
  onDone: () => void
}): UseRollback {
  const { modelId, onDone } = args
  const [target, setTarget] = useState<WriteBackHistoryItem | null>(null)
  const [plan, setPlan] = useState<RollbackDryRun | null>(null)
  const [checking, setChecking] = useState(false)
  const [rolling, setRolling] = useState(false)
  const [force, setForce] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const prepare = useCallback(
    async (batch: WriteBackHistoryItem) => {
      setTarget(batch)
      setPlan(null)
      setForce(false)
      setError(null)
      setChecking(true)
      try {
        const res = await modelEvaluationService.rollback(modelId, batch.id, {
          dryRun: true,
        })
        if (res.dryRun) setPlan(res)
      } catch (err) {
        setError(message(err, 'Could not check this rollback.'))
      } finally {
        setChecking(false)
      }
    },
    [modelId],
  )

  const confirm = useCallback(async () => {
    if (!target || !plan) return
    setRolling(true)
    setError(null)
    try {
      const res = await modelEvaluationService.rollback(modelId, target.id, {
        force,
      })
      if (!res.dryRun) {
        const b = res.batch
        if (b.status === 'SUCCEEDED') {
          toast.success(`Rolled back ${b.okCount} points on ${b.tag}`, {
            description: 'PI holds the values it had before that write.',
          })
        } else {
          toast.error(
            `${b.status === 'PARTIAL' ? 'Partly rolled back' : 'Not rolled back'}: ${b.okCount} of ${b.pointCount} points verified in PI`,
            {
              description:
                b.error ?? 'Run the rollback again to retry the rest.',
            },
          )
        }
        setTarget(null)
        setPlan(null)
        onDone()
      }
    } catch (err) {
      // State moved since the dry run (another write, new drift): say so in
      // place and let the user re-read it, rather than closing on a toast.
      setError(message(err, 'The rollback failed.'))
      try {
        const fresh = await modelEvaluationService.rollback(
          modelId,
          target.id,
          {
            dryRun: true,
          },
        )
        if (fresh.dryRun) setPlan(fresh)
      } catch {
        // The dialog keeps the refusal above; the old plan stays as shown.
      }
      onDone()
    } finally {
      setRolling(false)
    }
  }, [modelId, target, plan, force, onDone])

  const cancel = useCallback(() => {
    setTarget(null)
    setPlan(null)
    setError(null)
    setForce(false)
  }, [])

  return {
    target,
    plan,
    checking,
    rolling,
    force,
    error,
    canProceed: plan ? canRollbackNow(plan, force) : false,
    prepare,
    setForce,
    confirm,
    cancel,
  }
}
