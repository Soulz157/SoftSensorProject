'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { appendModelLog, updateModel } from '@/services/model'
import {
  buildMockMetrics,
  buildRetrainLogs,
  type EvalMetrics,
  type RetrainConfig,
  type RetrainPhase,
} from '@/lib/retrain'
import type { AIModel } from '@/types'

type Mode = 'auto' | 'custom'

/** Delay between simulated training log lines. */
const STEP_MS = 700

export interface UseModelRetrain {
  isRetraining: boolean
  mode: Mode | null
  phase: RetrainPhase
  metrics: EvalMetrics | null
  autoFinetune: () => void
  customFinetune: (config: RetrainConfig) => void
  reset: () => void
}

/**
 * Drives a simulated retrain: flips `deployStatus` to `initializing`, streams
 * training log lines via the real `appendModelLog` endpoint, then sets `running`.
 * No real training happens — swap the loop body for a real job trigger later.
 */
export function useModelRetrain({
  model,
  onUpdated,
}: {
  model: AIModel | null
  onUpdated?: () => void
}): UseModelRetrain {
  const [isRetraining, setIsRetraining] = useState(false)
  const [mode, setMode] = useState<Mode | null>(null)
  const [phase, setPhase] = useState<RetrainPhase>('idle')
  const [metrics, setMetrics] = useState<EvalMetrics | null>(null)
  const cancelled = useRef(false)

  useEffect(() => {
    cancelled.current = false
    return () => {
      cancelled.current = true
    }
  }, [])

  const reset = useCallback(() => {
    setPhase('idle')
    setMetrics(null)
    setMode(null)
  }, [])

  const run = useCallback(
    async (m: Mode, config?: RetrainConfig) => {
      if (isRetraining || !model) return
      setIsRetraining(true)
      setMode(m)
      setMetrics(null)
      setPhase('training')
      const wait = () => new Promise(resolve => setTimeout(resolve, STEP_MS))
      try {
        await updateModel(model.id, { deployStatus: 'initializing' })

        // Split the simulated log stream across Training / Validating phases.
        const logs = buildRetrainLogs(m, config)
        const valIdx = logs.findIndex(l => /validat/i.test(l))
        const splitAt = valIdx >= 0 ? valIdx : Math.ceil(logs.length / 2)

        // Phase 1 — Training
        for (const line of logs.slice(0, splitAt)) {
          if (cancelled.current) return
          await appendModelLog(model.id, { level: 'info', message: line })
          await wait()
        }

        // Phase 2 — Validating
        if (cancelled.current) return
        setPhase('validating')
        for (const line of logs.slice(splitAt)) {
          if (cancelled.current) return
          await appendModelLog(model.id, { level: 'info', message: line })
          await wait()
        }

        // Phase 3 — Evaluating (compute metrics, deploy)
        if (cancelled.current) return
        setPhase('evaluating')
        await wait()
        const evalMetrics = buildMockMetrics(model.id, config)
        await updateModel(model.id, { deployStatus: 'running' })
        await appendModelLog(model.id, {
          level: 'info',
          message: `Eval — RMSE ${evalMetrics.rmse}, R² ${evalMetrics.r2}, MAE ${evalMetrics.mae}`,
        })
        await appendModelLog(model.id, {
          level: 'info',
          message: 'Retrain complete — model deployed',
        })
        if (cancelled.current) return
        setMetrics(evalMetrics)
        setPhase('done')
        toast.success(`${model.name} retrained`)
        onUpdated?.()
      } catch {
        if (!cancelled.current) setPhase('error')
        try {
          await updateModel(model.id, { deployStatus: 'error' })
        } catch {
          // best-effort status reset
        }
        if (!cancelled.current) toast.error('Retrain failed')
        onUpdated?.()
      } finally {
        if (!cancelled.current) {
          setIsRetraining(false)
          setMode(null)
        }
      }
    },
    [isRetraining, model?.id, model?.name, onUpdated],
  )

  const autoFinetune = useCallback(() => void run('auto'), [run])
  const customFinetune = useCallback(
    (config: RetrainConfig) => void run('custom', config),
    [run],
  )

  return {
    isRetraining,
    mode,
    phase,
    metrics,
    autoFinetune,
    customFinetune,
    reset,
  }
}
