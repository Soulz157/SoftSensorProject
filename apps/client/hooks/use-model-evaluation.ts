'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TimeRange } from '@/lib/mock-readings'
import { generateLabComparison } from '@/lib/mock-lab-data'
import {
  computeMetrics,
  generateAnalysis,
  type EvalAnalysis,
  type EvalMetrics,
  type EvalPoint,
} from '@/lib/model-evaluation'
import type { AIModel } from '@/types'

export interface UseModelEvaluation {
  points: EvalPoint[]
  metrics: EvalMetrics
  /** `null` until the user triggers `generate()`. */
  analysis: EvalAnalysis | null
  isGenerating: boolean
  /** Produce the on-demand analysis (simulated latency, mock-backed). */
  generate: () => void
}

/** Simulated analysis latency so the on-demand action feels like a real call. */
const GENERATE_DELAY_MS = 800

/**
 * Drives the model-evaluation panel: deterministic predicted-vs-lab data +
 * error metrics (memoized per model/range), plus an on-demand analysis action.
 *
 * Swap to a real LLM later by replacing the `generateAnalysis(...)` call inside
 * `generate` with a `services/` request — the return shape stays identical.
 */
export function useModelEvaluation(
  model: AIModel,
  range: TimeRange,
): UseModelEvaluation {
  const points = useMemo(
    () => generateLabComparison(model.id, range),
    [model.id, range],
  )
  const metrics = useMemo(() => computeMetrics(points), [points])

  const [analysis, setAnalysis] = useState<EvalAnalysis | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset stale analysis when the evaluated model or range changes.
  useEffect(() => {
    setAnalysis(null)
    setIsGenerating(false)
    if (timer.current) clearTimeout(timer.current)
  }, [model.id, range])

  // Clean up a pending timer on unmount.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const generate = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    setIsGenerating(true)
    timer.current = setTimeout(() => {
      setAnalysis(generateAnalysis(model, metrics, points))
      setIsGenerating(false)
    }, GENERATE_DELAY_MS)
  }, [model, metrics, points])

  return { points, metrics, analysis, isGenerating, generate }
}
