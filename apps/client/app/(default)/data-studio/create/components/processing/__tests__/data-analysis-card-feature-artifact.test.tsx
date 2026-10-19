import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { brandBoundedSample } from '@/lib/preprocessing'
import {
  dwDraftArtifactIdAtom,
  dwDraftFeatureArtifactIdAtom,
  dwDraftGoldArtifactIdAtom,
  dwDraftIdAtom,
} from '@/store/dataset-studio'

/**
 * 2026-10-19 bug: Step 4's Correlation Heatmap never showed a feature added
 * there. Since the DS-LAKE-022 reorder the create-mode feature warm writes
 * `dwDraftFeatureArtifactIdAtom`, not the GOLD atom, so the card read the raw
 * BRONZE - and Correlation, the one tab that keeps only tags the artifact
 * HAS, dropped every feature column.
 */

const h = vi.hoisted(() => ({
  metaArgs: [] as Array<[string | null, string | null]>,
  corrArgs: [] as Array<[string | null, string | null, string[]]>,
}))

const META: Record<string, string[]> = {
  bronze: ['FI-1', 'TI-2'],
  features: ['FI-1', 'TI-2', 'FI-1__lag1'],
  gold: ['FI-1', 'TI-2', 'FI-1__lag1'],
}

vi.mock('@/hooks/dataset/artifact/use-dataset-artifact-metadata', () => ({
  useDatasetArtifactMetadata: (draftId: string | null, id: string | null) => {
    h.metaArgs.push([draftId, id])
    return {
      metadata: id
        ? { tags: META[id] ?? [], startTime: null, endTime: null }
        : null,
      loading: false,
      error: null,
    }
  },
  useArtifactMetadata: () => ({ metadata: null, loading: false, error: null }),
}))
vi.mock('@/hooks/dataset/use-dataset-correlation', () => ({
  useDatasetCorrelation: (
    draftId: string | null,
    id: string | null,
    tags: string[],
  ) => {
    h.corrArgs.push([draftId, id, tags])
    return { correlation: null, loading: false, error: null }
  },
}))
const idle = { loading: false, error: null }
vi.mock('@/hooks/dataset/artifact/use-artifact-correlation', () => ({
  useArtifactCorrelation: () => ({ correlation: null, ...idle }),
}))
vi.mock('@/hooks/dataset/use-dataset-histogram', () => ({
  useDatasetHistogram: () => ({ histogram: null, ...idle }),
}))
vi.mock('@/hooks/dataset/artifact/use-artifact-histogram', () => ({
  useArtifactHistogram: () => ({ histogram: null, ...idle }),
}))
vi.mock('@/hooks/dataset/use-dataset-boxplot', () => ({
  useDatasetBoxplot: () => ({ boxplot: null, ...idle }),
}))
vi.mock('@/hooks/dataset/artifact/use-artifact-boxplot', () => ({
  useArtifactBoxplot: () => ({ boxplot: null, ...idle }),
}))
vi.mock('@/hooks/dataset/use-dataset-scatter', () => ({
  useDatasetScatter: () => ({ scatter: null, ...idle }),
}))
vi.mock('@/hooks/dataset/artifact/use-artifact-scatter', () => ({
  useArtifactScatter: () => ({ scatter: null, ...idle }),
}))
vi.mock('../../chart/raw-data-chart', () => ({ RawTrendChart: () => null }))
vi.mock('../../chart/tag-histogram-chart', () => ({
  TagHistogramChart: () => null,
}))
vi.mock('../../chart/tag-boxplot-chart', () => ({
  TagBoxplotChart: () => null,
}))
vi.mock('../../chart/tag-scatter-chart', () => ({
  TagScatterChart: () => null,
}))
vi.mock('../../chart/tag-correlation-chart', () => ({
  TagCorrelationChart: () => null,
}))

import { DataAnalysisCard } from '../data-analysis-card'

const SAMPLE = brandBoundedSample({
  tags: ['FI-1', 'TI-2', 'FI-1__lag1'],
  rows: [
    {
      timestamp: '2026-01-01 00:00:00',
      cells: {
        'FI-1': { value: 1, status: 'Good' },
        'TI-2': { value: 2, status: 'Good' },
        'FI-1__lag1': { value: 0, status: 'Bad' },
      },
    },
  ],
})

function renderCard(
  atoms: { gold?: string | null; features?: string | null },
  readFeatureArtifact?: boolean,
) {
  const store = createStore()
  store.set(dwDraftIdAtom, 'draft-1')
  store.set(dwDraftArtifactIdAtom, 'bronze')
  store.set(dwDraftFeatureArtifactIdAtom, atoms.features ?? null)
  store.set(dwDraftGoldArtifactIdAtom, atoms.gold ?? null)
  render(
    <Provider store={store}>
      <DataAnalysisCard
        dataset={SAMPLE}
        range="7d"
        showTransforms={false}
        readFeatureArtifact={readFeatureArtifact}
      />
    </Provider>,
  )
}

const lastCorr = () => h.corrArgs.at(-1)!

beforeEach(() => {
  h.metaArgs.length = 0
  h.corrArgs.length = 0
})

describe('DataAnalysisCard — which artifact Step 4 reads', () => {
  it('Step 4 reads the features artifact, so Correlation includes the new feature', () => {
    renderCard({ features: 'features' }, true)
    const [, id, tags] = lastCorr()
    expect(id).toBe('features')
    expect(tags).toContain('FI-1__lag1')
  })

  it('without the opt-in (Step 3.1) it stays on the raw artifact', () => {
    renderCard({ features: 'features' })
    const [, id, tags] = lastCorr()
    expect(id).toBe('bronze')
    expect(tags).not.toContain('FI-1__lag1')
  })

  it('a GOLD still wins once it exists', () => {
    renderCard({ features: 'features', gold: 'gold' }, true)
    expect(lastCorr()[1]).toBe('gold')
  })

  it('falls back to the raw artifact before the first feature warm lands', () => {
    renderCard({}, true)
    expect(lastCorr()[1]).toBe('bronze')
  })
})
