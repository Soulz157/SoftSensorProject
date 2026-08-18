'use client'

import { useMemo } from 'react'
import type { SavedDataset } from '@/store/datasets'
import type { Dataset } from '@/lib/preprocessing'
import { buildRawDataset } from '@/lib/preprocessing'
import type { TimeRange } from '@/lib/mock-readings'
import {
  datasetKpis,
  topCorrelatedPairs,
  type DatasetKpis,
} from '@/lib/dataset-stats'
import type { TagPair } from '@/lib/data-quality'

interface UseDatasetDetailResult {
  ds: Dataset
  kpis: DatasetKpis
  topPairs: TagPair[]
}

const EMPTY_DS: Dataset = { tags: [], rows: [] }

/**
 * Reconstructs a dataset's rows from its tag names (Phase-6 mock layer,
 * `buildRawDataset`) and derives the KPI summary + top correlated tag pairs.
 * Memoised on `dataset.id + range` so the readings aren't regenerated on every
 * render — the same hook backs both a grid card (KPIs only) and the detail
 * slide-over (full `ds` for the preview table).
 *
 * Swap path: when a real dataset-rows endpoint lands, replace `buildRawDataset`
 * with a `services/` fetch returning the same `Dataset`; the derivations stay.
 */
export function useDatasetDetail(
  dataset: SavedDataset | null,
  range: TimeRange = '24h',
): UseDatasetDetailResult {
  const key = dataset ? `${dataset.id}:${range}:${dataset.tags.join(',')}` : ''

  return useMemo(() => {
    if (!dataset || dataset.tags.length === 0) {
      return {
        ds: EMPTY_DS,
        kpis: { mean: 0, median: 0, sd: 0 },
        topPairs: [],
      }
    }
    const ds = buildRawDataset(dataset.tags, range)
    return { ds, kpis: datasetKpis(ds), topPairs: topCorrelatedPairs(ds) }
    // `key` captures the only inputs that change the result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}
