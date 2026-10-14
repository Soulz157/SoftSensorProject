'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  modelEvaluationService,
  type EvaluationCompareResult,
} from '@/services/model-evaluation'
import {
  buildChartRows,
  defaultRange,
  pairLab,
  stampToUtcIso,
  validateRange,
  type ChartRow,
} from '@/lib/evaluation-compare'
import {
  activeLab,
  addLabRow,
  addLabRows,
  editLabRow,
  labChangeCount,
  parseLabCsvPlantTime,
  removeLabRow,
  restoreLabRow,
  seedLab,
  type LabRow,
} from '@/lib/evaluation-lab'
import type { LabPoint } from '@/lib/lab-ingestion'
import {
  computeMetrics,
  type EvalMetrics,
  type EvalPoint,
} from '@/lib/model-evaluation'
import type { AIModel } from '@/types'

export interface UseModelEvaluation {
  // ── range ──────────────────────────────────────────────────────────
  /** Plant wall-clock stamps, `yyyy-MM-ddTHH:mm`. */
  from: string
  to: string
  setFrom: (stamp: string) => void
  setTo: (stamp: string) => void
  /** What is wrong with the picked range, before any request. */
  rangeError: string | null

  // ── import ─────────────────────────────────────────────────────────
  /** Fetch the range from the model's data source and score it now. */
  importRange: () => Promise<void>
  loading: boolean
  /** The server's own refusal text (range too big, no schedule, ...). */
  error: string | null
  /** The last successful import; null until one has run. */
  data: EvaluationCompareResult | null

  // ── derived from data + lab ────────────────────────────────────────
  rows: ChartRow[]
  /** Lab/prediction pairs: imported lab events plus applied user points. */
  pairs: EvalPoint[]
  metrics: EvalMetrics
  /** The lab series behind `pairs`: imported events with the user's edits
   *  applied and removals left out. */
  labPoints: LabPoint[]

  // ── the editable lab series ────────────────────────────────────────
  /** Every row, including removed ones (so they can be restored). Seeded
   *  from the raw recorded lab events on each import. */
  labRows: LabRow[]
  /** Edited + added + removed rows, i.e. how far it has moved from import. */
  labChanges: number
  addLab: (point: LabPoint) => void
  editLab: (timestamp: string, value: number) => void
  removeLab: (timestamp: string) => void
  restoreLab: (timestamp: string) => void
  importLabCsv: (text: string) => { added: number; errors: string[] }
  /** Drop every edit and go back to the imported lab events. */
  resetLab: () => void
}

/**
 * MODEL-SERVE-032. Drives the Evaluation page: pick a range, import it from
 * the model's data source (predictions are scored NOW by the PRODUCTION
 * version; lab values are the raw recorded events), and compare.
 *
 * The lab series starts as the raw recorded events and stays editable; each
 * row remembers its imported original, so a reset needs no re-import.
 * Pairing and metrics are pure derivations over it (`lib/evaluation-compare`),
 * so they follow every edit without another request.
 *
 * The component that uses this is keyed by model id, so a model switch
 * remounts it and nothing here has to detect one.
 */
export function useModelEvaluation(model: AIModel): UseModelEvaluation {
  const [initial] = useState(() => defaultRange())
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)

  const [data, setData] = useState<EvaluationCompareResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A slow response from an earlier click must not overwrite a newer one.
  const latest = useRef(0)

  const [labRows, setLabRows] = useState<LabRow[]>([])

  const rangeError = validateRange(from, to)

  const importRange = useCallback(async () => {
    const problem = validateRange(from, to)
    const fromIso = stampToUtcIso(from)
    const toIso = stampToUtcIso(to)
    if (problem || !fromIso || !toIso) {
      setError(problem ?? 'Pick a valid range.')
      return
    }
    const ticket = ++latest.current
    setLoading(true)
    setError(null)
    try {
      const result = await modelEvaluationService.compare(
        model.id,
        fromIso,
        toIso,
      )
      if (ticket !== latest.current) return
      setData(result)
      // A fresh import starts from the recorded events; edits made to the
      // previous range's series belong to that range.
      setLabRows(seedLab(result.lab.events))
    } catch (err) {
      if (ticket !== latest.current) return
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not import this range.',
      )
    } finally {
      if (ticket === latest.current) setLoading(false)
    }
  }, [model.id, from, to])

  const labPoints = useMemo(() => activeLab(labRows), [labRows])
  const rows = useMemo(
    () => (data ? buildChartRows(data, labPoints) : []),
    [data, labPoints],
  )
  const pairs = useMemo(
    () => (data ? pairLab(data, labPoints) : []),
    [data, labPoints],
  )
  const metrics = useMemo(() => computeMetrics(pairs), [pairs])

  const labChanges = useMemo(() => labChangeCount(labRows), [labRows])

  const addLab = useCallback((point: LabPoint) => {
    setLabRows(prev => addLabRow(prev, point))
  }, [])
  const editLab = useCallback((timestamp: string, value: number) => {
    setLabRows(prev => editLabRow(prev, timestamp, value))
  }, [])
  const removeLab = useCallback((timestamp: string) => {
    setLabRows(prev => removeLabRow(prev, timestamp))
  }, [])
  const restoreLab = useCallback((timestamp: string) => {
    setLabRows(prev => restoreLabRow(prev, timestamp))
  }, [])
  const importLabCsv = useCallback((text: string) => {
    const { points, errors } = parseLabCsvPlantTime(text)
    if (points.length > 0) setLabRows(prev => addLabRows(prev, points))
    return { added: points.length, errors }
  }, [])
  const resetLab = useCallback(() => {
    setLabRows(data ? seedLab(data.lab.events) : [])
  }, [data])

  return {
    from,
    to,
    setFrom,
    setTo,
    rangeError,
    importRange,
    loading,
    error,
    data,
    rows,
    pairs,
    metrics,
    labPoints,
    labRows,
    labChanges,
    addLab,
    editLab,
    removeLab,
    restoreLab,
    importLabCsv,
    resetLab,
  }
}
