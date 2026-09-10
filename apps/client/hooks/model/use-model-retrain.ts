'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { appendModelLog } from '@/services/model'
import {
  buildMockMetrics,
  buildRetrainLogs,
  type EvalMetrics,
  type RetrainConfig,
  type RetrainPhase,
} from '@/lib/retrain'
import type { AIModel } from '@/types'

type Mode = 'auto' | 'custom'

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
        // MODEL-SERVE-006-T12. deployStatus is derived now, not caller-set —
        // this mock retrain flow's progress used to fake it through three
        // states; the model's REAL deployStatus (from InferenceWindow/
        // InferenceSchedule) is unrelated to this simulation's own phase
        // state, which is already tracked separately above (`setPhase`).
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
        if (!cancelled.current) toast.error('Retrain failed')
        onUpdated?.()
      } finally {
        if (!cancelled.current) {
          setIsRetraining(false)
          setMode(null)
        }
      }
    },
    [isRetraining, onUpdated, model],
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
