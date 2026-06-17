'use client'

import { useMemo } from 'react'
import { useAtomValue } from 'jotai'
import { rawDatasetAtom, timeRangeAtom } from '@/store/data-visualize'
import { StepView } from './step-view'

export function Step5RawData() {
  const raw = useAtomValue(rawDatasetAtom)
  const range = useAtomValue(timeRangeAtom)

  const summary = useMemo(() => {
    const badRows = raw.rows.filter(r =>
      raw.tags.some(t => r.cells[t]?.status === 'Bad'),
    ).length
    let questionableCells = 0
    for (const r of raw.rows) {
      for (const t of raw.tags) {
        if (r.cells[t]?.status === 'Questionable') questionableCells++
      }
    }
    return `${raw.rows.length} rows · ${badRows} bad · ${questionableCells} questionable cells`
  }, [raw])

  return <StepView dataset={raw} range={range} showQuality summary={summary} />
}
