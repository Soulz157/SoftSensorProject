'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  useSensorReadings,
  type SensorChartRow,
} from '@/hooks/use-sensor-readings'
import {
  buildRawDataset,
  CORRELATED_PAIR,
  type Dataset,
} from '@/lib/preprocessing'
import { datasetToCsv } from '@/lib/csv'
import { type TimeRange } from '@/lib/mock-readings'

export type VisualizerMode = 'line' | 'scatter'

/**
 * Default selection = the correlated pair (`TI-101`/`PI-303`) so the scatter
 * view shows a genuine regression (R² ≫ 0) out of the box, not a flat cloud.
 */
const DEFAULT_TAGS = [CORRELATED_PAIR.anchor, CORRELATED_PAIR.derived]

export interface UseQuickVisualizerResult {
  selectedTags: string[]
  toggleTag: (piTag: string) => void
  range: TimeRange
  setRange: (range: TimeRange) => void
  mode: VisualizerMode
  setMode: (mode: VisualizerMode) => void
  rows: SensorChartRow[]
  dataset: Dataset
  isFetching: boolean
  exportCsv: () => void
}

/**
 * Local state for the embedded Quick Visualizer panel.
 *
 * Plots the selected PI tags via the shared `useSensorReadings` (line) and a
 * `buildRawDataset` (scatter + CSV export). Mirrors the Data Visualize wizard's
 * data path so the two stay consistent.
 */
export function useQuickVisualizer(): UseQuickVisualizerResult {
  const [selectedTags, setSelectedTags] = useState<string[]>(DEFAULT_TAGS)
  const [range, setRange] = useState<TimeRange>('24h')
  const [mode, setMode] = useState<VisualizerMode>('line')

  const toggleTag = useCallback((piTag: string) => {
    setSelectedTags(prev =>
      prev.includes(piTag) ? prev.filter(t => t !== piTag) : [...prev, piTag],
    )
  }, [])

  const { rows, isFetching } = useSensorReadings(selectedTags, range)

  const tagsKey = selectedTags.join(',')
  const dataset = useMemo(
    () => buildRawDataset(tagsKey ? tagsKey.split(',') : [], range),
    [tagsKey, range],
  )

  const exportCsv = useCallback(() => {
    const csv = datasetToCsv(dataset)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pi-readings-${range}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [dataset, range])

  return {
    selectedTags,
    toggleTag,
    range,
    setRange,
    mode,
    setMode,
    rows,
    dataset,
    isFetching,
    exportCsv,
  }
}
