'use client'

import { useMemo } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import type { EdaWindowControl } from '@/lib/time-window'
import {
  dwEdaSampleTotalAtom,
  dwEdaWindowAtom,
  dwFeaturePreviewSampleAtom,
  dwFeaturePreviewSampleStateAtom,
} from '@/store/dataset-studio'

/**
 * The EDA period picker's wiring for the Data Studio wizard: the window atom
 * `useDatasetFeaturePreviewSample` fetches within, plus the two facts the
 * card needs to caption it (is the next page in flight, how many rows match).
 *
 * Both wizard steps that mount `DataAnalysisCard` (3.1 and 4) read the SAME
 * sample atom, so they must share one window — a month chosen at 3.1 would
 * otherwise still be filtering Step 4's preview with no picker to undo it.
 */
export function useEdaWindowControl(): EdaWindowControl {
  const [value, onChange] = useAtom(dwEdaWindowAtom)
  const totalRows = useAtomValue(dwEdaSampleTotalAtom)
  const fetchState = useAtomValue(dwFeaturePreviewSampleStateAtom)
  const loadedRows = useAtomValue(dwFeaturePreviewSampleAtom).rows.length
  const loading = fetchState === 'loading' || fetchState === 'refreshing'

  return useMemo(
    () => ({ value, onChange, loading, totalRows, loadedRows }),
    [value, onChange, loading, totalRows, loadedRows],
  )
}
