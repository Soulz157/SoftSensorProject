'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { rangeConfig, type TimeRange } from '@/lib/mock-readings'
import { generatePredictions, type PredPoint } from '@/lib/mock-lab-data'
import {
  alignLabToPredictions,
  parseLabCsv,
  type LabPoint,
} from '@/lib/lab-ingestion'
import {
  computeMetrics,
  generateAnalysis,
  type EvalAnalysis,
  type EvalMetrics,
  type EvalPoint,
} from '@/lib/model-evaluation'
import type { AIModel } from '@/types'

export interface UseModelEvaluation {
  /** Model prediction series (always present). */
  preds: PredPoint[]
  /** Applied lab points aligned to predictions — drives chart + metrics. */
  points: EvalPoint[]
  metrics: EvalMetrics
  /** `null` until the user triggers `generate()`. */
  analysis: EvalAnalysis | null
  isGenerating: boolean
  /** Produce the on-demand analysis (simulated latency, mock-backed). */
  generate: () => void

  // ── Lab ground-truth ingestion ──────────────────────────────────────
  /** Working set the user is editing (not yet compared). */
  draftLab: LabPoint[]
  /** Snapshot last compared (drives `points`/`metrics`). */
  appliedLab: LabPoint[]
  /** True when the draft differs from what's applied. */
  isDirty: boolean
  /** Append one manually-entered lab point to the draft. */
  addLabPoint: (point: LabPoint) => void
  /** Remove a draft point by index. */
  removeDraftPoint: (index: number) => void
  /** Merge parsed CSV rows into the draft; returns counts for UX feedback. */
  importCsv: (text: string) => { added: number; errors: string[] }
  /** Promote the draft to applied → recompute comparison. */
  apply: () => void
  /** Clear both draft and applied lab data. */
  clearLab: () => void
}

/** Simulated analysis latency so the on-demand action feels like a real call. */
const GENERATE_DELAY_MS = 800

/**
 * Drives the model-evaluation panel: a deterministic model prediction series
 * plus user-supplied laboratory ground truth. The user builds a `draftLab` set
 * (manual entry / CSV) and applies it; applied points are aligned to the
 * predictions by nearest timestamp and scored (RMSE / MAE / R² / bias). The
 * on-demand analysis runs over the aligned pairs.
 *
 * Swap to real data later by replacing `generatePredictions(...)` with a
 * `services/` request and the `generateAnalysis(...)` call with an LLM call —
 * the return shape stays identical.
 */
export function useModelEvaluation(
  model: AIModel,
  range: TimeRange,
): UseModelEvaluation {
  const preds = useMemo(
    () => generatePredictions(model.id, range),
    [model.id, range],
  )
  const toleranceMs = useMemo(() => rangeConfig(range).stepMs, [range])

  const [draftLab, setDraftLab] = useState<LabPoint[]>([])
  const [appliedLab, setAppliedLab] = useState<LabPoint[]>([])

  // Lab data is per-model: reset both buffers when the model changes (but keep
  // them across a range switch — the tag/measurement set is unchanged).
  useEffect(() => {
    setDraftLab([])
    setAppliedLab([])
  }, [model.id])

  const points = useMemo(
    () => alignLabToPredictions(preds, appliedLab, toleranceMs),
    [preds, appliedLab, toleranceMs],
  )
  const metrics = useMemo(() => computeMetrics(points), [points])

  const isDirty = useMemo(
    () => JSON.stringify(draftLab) !== JSON.stringify(appliedLab),
    [draftLab, appliedLab],
  )

  const addLabPoint = useCallback((point: LabPoint) => {
    setDraftLab(prev =>
      [...prev, point].sort(
        (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
      ),
    )
  }, [])

  const removeDraftPoint = useCallback((index: number) => {
    setDraftLab(prev => prev.filter((_, i) => i !== index))
  }, [])

  const importCsv = useCallback((text: string) => {
    const { points: parsed, errors } = parseLabCsv(text)
    if (parsed.length > 0) {
      setDraftLab(prev =>
        [...prev, ...parsed].sort(
          (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
        ),
      )
    }
    return { added: parsed.length, errors }
  }, [])

  const apply = useCallback(() => {
    setAppliedLab(draftLab)
  }, [draftLab])

  const clearLab = useCallback(() => {
    setDraftLab([])
    setAppliedLab([])
  }, [])

  const [analysis, setAnalysis] = useState<EvalAnalysis | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset stale analysis when the evaluated model, range, or applied data shifts.
  useEffect(() => {
    setAnalysis(null)
    setIsGenerating(false)
    if (timer.current) clearTimeout(timer.current)
  }, [model.id, range, appliedLab])

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

  return {
    preds,
    points,
    metrics,
    analysis,
    isGenerating,
    generate,
    draftLab,
    appliedLab,
    isDirty,
    addLabPoint,
    removeDraftPoint,
    importCsv,
    apply,
    clearLab,
  }
}
