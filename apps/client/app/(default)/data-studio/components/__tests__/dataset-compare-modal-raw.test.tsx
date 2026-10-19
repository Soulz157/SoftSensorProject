import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * "Raw (Bronze)" as the compare modal's left side (2026-10-18): the dataset's
 * raw fetch against the validation holdout, with the holdout window taken
 * OUT of the raw reads — it can sit in the middle of the span, so rows
 * before AND after it stay.
 *
 * Hooks are mocked and record what they are asked for; what is asserted is
 * the modal's wiring: which artifact the left side reads, with which exclude
 * window, and that raw values are never run through the scaler inversion.
 */

const h = vi.hoisted(() => ({
  rowsCalls: [] as Array<{
    artifactId: string | null
    tags: string[]
    excludeWindow: unknown
  }>,
  histCalls: [] as Array<{
    artifactId: string | null
    tags: string[]
    excludeWindow: unknown
  }>,
  bronzeEnd: '2026-01-31 23:00:00',
}))

const tagHist = (tag: string, min: number, max: number) => ({
  tag,
  mean: (min + max) / 2,
  median: (min + max) / 2,
  mode: min,
  std: 1,
  min,
  max,
  range: max - min,
  count: 10,
  kde: [],
})

vi.mock('@/hooks/dataset/artifact/use-artifact-feature-spec', () => ({
  useArtifactFeatureSpec: () => ({
    featureSpec: {
      scalingParams: {
        T1: { min: 0, max: 100 },
        ENG: { min: 0, max: 1 },
      },
    },
    loading: false,
    missing: false,
    error: null,
  }),
}))
vi.mock('@/hooks/dataset/artifact/use-dataset-artifact-metadata', () => ({
  useArtifactMetadata: (_d: string | null, artifactId: string | null) => ({
    metadata:
      artifactId === 'bronze-1'
        ? {
            startTime: '2025-07-01 00:00:00',
            endTime: h.bronzeEnd,
            // No engineered column in the raw fetch.
            tags: ['T1'],
            rowCount: 5159,
          }
        : artifactId === 'art-1'
          ? {
              startTime: '2025-07-01 00:00:00',
              endTime: '2025-11-18 00:00:00',
              tags: ['T1', 'ENG'],
              rowCount: 3115,
            }
          : null,
  }),
}))
const noRows = {
  sample: null,
  totalRowCount: null,
  loading: false,
  missing: false,
  error: null,
}
vi.mock('@/hooks/dataset/artifact/use-artifact-rows', () => ({
  useArtifactRows: (
    _d: unknown,
    artifactId: string | null,
    tags: string[],
    options: { excludeWindow?: unknown },
  ) => {
    h.rowsCalls.push({
      artifactId,
      tags,
      excludeWindow: options.excludeWindow ?? null,
    })
    return noRows
  },
}))
vi.mock('@/hooks/dataset/artifact/use-artifact-validation-rows', () => ({
  useArtifactValidationRows: () => noRows,
}))
vi.mock('@/hooks/dataset/artifact/use-artifact-histogram', () => ({
  useArtifactHistogram: (
    _d: unknown,
    artifactId: string | null,
    tags: string[],
    _sample: unknown,
    _window: unknown,
    excludeWindow: unknown,
  ) => {
    h.histCalls.push({ artifactId, tags, excludeWindow: excludeWindow ?? null })
    // Same numbers either way; only the TRAIN side is stored scaled.
    return {
      histogram:
        tags.length > 0
          ? {
              source_key: 'k',
              domain_min: 0.1,
              domain_max: 0.4,
              tags: [tagHist('T1', 0.1, 0.4)],
              insufficient_tags: [],
            }
          : null,
      loading: false,
      error: null,
    }
  },
}))
vi.mock('@/hooks/dataset/artifact/use-artifact-validation-histogram', () => ({
  useArtifactValidationHistogram: () => ({
    histogram: null,
    loading: false,
    missing: false,
    tagMismatch: false,
    error: null,
  }),
}))
vi.mock('@/hooks/dataset/artifact/use-artifact-boxplot', () => ({
  useArtifactBoxplot: () => ({ boxplot: null, loading: false, error: null }),
}))
vi.mock('@/hooks/dataset/artifact/use-artifact-validation-boxplot', () => ({
  useArtifactValidationBoxplot: () => ({
    boxplot: null,
    loading: false,
    missing: false,
    tagMismatch: false,
    error: null,
  }),
}))
const noCorr = { correlation: null, loading: false, error: null }
vi.mock('@/hooks/dataset/artifact/use-artifact-correlation', () => ({
  useArtifactCorrelation: () => noCorr,
}))
vi.mock('@/hooks/dataset/artifact/use-artifact-validation-correlation', () => ({
  useArtifactValidationCorrelation: () => ({
    ...noCorr,
    missing: false,
    tagMismatch: false,
  }),
}))
vi.mock('@/hooks/dataset/use-monthly-compare', () => ({
  useMonthlyHistograms: () => ({ results: null, loading: false, error: null }),
  useMonthlyBoxplots: () => ({ results: null, loading: false, error: null }),
}))
vi.mock('../../create/components/raw-readings-table', () => ({
  RawReadingsTable: () => <div />,
}))
vi.mock('../../create/components/chart/tag-correlation-chart', () => ({
  TagCorrelationChart: () => <div />,
}))
vi.mock('../../create/components/chart/tag-boxplot-chart', () => ({
  TagBoxplotChart: () => <div />,
}))
vi.mock('../../create/components/chart/tag-histogram-chart', () => ({
  TagHistogramChart: (props: {
    data: { domain_min: number | null; domain_max: number | null } | null
  }) => (
    <div
      data-testid="hist"
      data-domain={JSON.stringify([
        props.data?.domain_min ?? null,
        props.data?.domain_max ?? null,
      ])}
    />
  ),
}))

import { DatasetCompareModal } from '../dataset-compare-modal'

// Stored as UTC instants; on the artifact's Bangkok wall clock these are
// 2025-11-06 19:00 and 2025-11-17 13:00 — inside the raw span, not its tail.
const HOLDOUT = {
  holdoutFrom: '2025-11-06T12:00:00.000Z',
  holdoutTo: '2025-11-17T06:00:00.000Z',
  rowCount: 259,
  missingPct: 0,
}
const WALL_EXCLUDE = {
  excludeStart: '2025-11-06 19:00:00',
  excludeEnd: '2025-11-17 13:00:00',
}

function renderModal(
  extra: {
    rawArtifactId?: string | null
    holdout?: typeof HOLDOUT | { holdoutTo: null } | null
  } = {},
) {
  const props = {
    onOpenChange: () => {},
    datasetId: 'ds-1',
    artifactId: 'art-1',
    availableTags: ['T1', 'ENG'],
    holdout: HOLDOUT,
    ...extra,
  } as Parameters<typeof DatasetCompareModal>[0]
  const view = render(<DatasetCompareModal {...props} open={false} />)
  view.rerender(<DatasetCompareModal {...props} open />)
  return view
}

const lastRows = () => h.rowsCalls[h.rowsCalls.length - 1]!

beforeEach(() => {
  h.rowsCalls.length = 0
  h.histCalls.length = 0
  h.bronzeEnd = '2026-01-31 23:00:00'
})

describe('DatasetCompareModal — Raw (Bronze) source', () => {
  it('offers no source toggle when the caller does not pass rawArtifactId', () => {
    renderModal()
    expect(
      screen.queryByRole('button', { name: 'Raw (Bronze)' }),
    ).not.toBeInTheDocument()
    expect(lastRows()).toEqual({
      artifactId: 'art-1',
      tags: ['T1'],
      excludeWindow: null,
    })
  })

  it('says why Raw is unavailable when the dataset kept no raw fetch', () => {
    renderModal({ rawArtifactId: null })
    expect(
      screen.queryByRole('button', { name: 'Raw (Bronze)' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(/keeps no raw \(BRONZE\) fetch/),
    ).toBeInTheDocument()
  })

  it('reads the bronze artifact minus the validation window, on the wall clock', async () => {
    const user = userEvent.setup()
    renderModal({ rawArtifactId: 'bronze-1' })
    expect(lastRows().artifactId).toBe('art-1')

    await user.click(screen.getByRole('button', { name: 'Raw (Bronze)' }))

    expect(lastRows()).toEqual({
      artifactId: 'bronze-1',
      tags: ['T1'],
      excludeWindow: WALL_EXCLUDE,
    })
    // An engineered column is not in the fetch, so it is not offered.
    expect(screen.getByText(/not in the raw fetch/)).toBeInTheDocument()
  })

  it('never inverts raw values with the scaler fit', async () => {
    const user = userEvent.setup()
    renderModal({ rawArtifactId: 'bronze-1' })
    await user.click(screen.getByRole('tab', { name: /Histogram/ }))
    const domain = () =>
      JSON.parse(screen.getByTestId('hist').getAttribute('data-domain') ?? '[]')
    // Training side: 0.1..0.4 scaled → 10..40 with min 0 / max 100.
    expect(domain()).toEqual([10, 40])

    await user.click(screen.getByRole('button', { name: 'Raw (Bronze)' }))
    expect(domain()).toEqual([0.1, 0.4])
    const last = h.histCalls[h.histCalls.length - 1]!
    expect(last.artifactId).toBe('bronze-1')
    expect(last.excludeWindow).toEqual(WALL_EXCLUDE)
  })

  it('closes an open-ended holdout at the raw fetch end', async () => {
    const user = userEvent.setup()
    renderModal({
      rawArtifactId: 'bronze-1',
      holdout: { ...HOLDOUT, holdoutTo: null },
    })
    await user.click(screen.getByRole('button', { name: 'Raw (Bronze)' }))
    expect(lastRows().excludeWindow).toEqual({
      excludeStart: WALL_EXCLUDE.excludeStart,
      excludeEnd: '2026-01-31 23:00:00',
    })
  })

  it('goes back to Training on reopen', async () => {
    const user = userEvent.setup()
    const view = renderModal({ rawArtifactId: 'bronze-1' })
    await user.click(screen.getByRole('button', { name: 'Raw (Bronze)' }))
    const props = {
      onOpenChange: () => {},
      datasetId: 'ds-1',
      artifactId: 'art-1',
      availableTags: ['T1', 'ENG'],
      holdout: HOLDOUT,
      rawArtifactId: 'bronze-1',
    }
    view.rerender(<DatasetCompareModal {...props} open={false} />)
    view.rerender(<DatasetCompareModal {...props} open />)
    expect(lastRows().artifactId).toBe('art-1')
    expect(lastRows().excludeWindow).toBeNull()
  })
})
