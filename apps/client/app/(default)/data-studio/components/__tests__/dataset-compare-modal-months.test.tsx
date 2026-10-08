import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * "By month" in the Compare-validation modal's Histogram and Box Plot tabs:
 * the validation holdout drawn beside several TRAINING months of one tag.
 *
 * The data hooks are mocked and the charts are replaced by stubs that expose
 * the props they were handed, so what is asserted is the modal's own wiring:
 * which series reach the chart, in what order, and which requests it makes.
 */

const h = vi.hoisted(() => ({
  trainHistTags: [] as string[][],
  validationHistTags: [] as string[][],
  monthlyHistArgs: [] as Array<{
    tag: string | null
    keys: string[]
    enabled: boolean
  }>,
  validationHistogram: null as unknown,
  validationBoxplot: null as unknown,
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
const histResult = (...tags: ReturnType<typeof tagHist>[]) => ({
  source_key: 'k',
  domain_min: Math.min(...tags.map(t => t.min)),
  domain_max: Math.max(...tags.map(t => t.max)),
  tags,
  insufficient_tags: [],
})
const tagBox = (tag: string) => ({
  tag,
  min: 0,
  q1: 0.2,
  median: 0.5,
  mean: 0.5,
  q3: 0.7,
  max: 1,
  whisker_low: 0,
  whisker_high: 1,
  outliers: [],
  outlier_count: 0,
  count: 10,
})
const boxResult = (...tags: ReturnType<typeof tagBox>[]) => ({
  source_key: 'k',
  tags,
  insufficient_tags: [],
})

vi.mock('@/hooks/dataset/artifact/use-artifact-feature-spec', () => ({
  useArtifactFeatureSpec: () => ({
    featureSpec: { scalingParams: { T1: { min: 0, max: 100 } } },
    loading: false,
    missing: false,
    error: null,
  }),
}))
vi.mock('@/hooks/dataset/artifact/use-dataset-artifact-metadata', () => ({
  useArtifactMetadata: () => ({
    metadata: {
      startTime: '2026-01-01 00:00:00',
      endTime: '2026-03-31 23:00:00',
      tags: ['T1'],
      rowCount: 100,
    },
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
  useArtifactRows: () => noRows,
}))
vi.mock('@/hooks/dataset/artifact/use-artifact-validation-rows', () => ({
  useArtifactValidationRows: () => noRows,
}))
vi.mock('@/hooks/dataset/artifact/use-artifact-histogram', () => ({
  useArtifactHistogram: (_d: unknown, _a: unknown, tags: string[]) => {
    h.trainHistTags.push(tags)
    return { histogram: null, loading: false, error: null }
  },
}))
vi.mock('@/hooks/dataset/artifact/use-artifact-validation-histogram', () => ({
  useArtifactValidationHistogram: (
    _d: unknown,
    _a: unknown,
    tags: string[],
  ) => {
    h.validationHistTags.push(tags)
    return {
      histogram: tags.length > 0 ? h.validationHistogram : null,
      loading: false,
      missing: false,
      tagMismatch: false,
      error: null,
    }
  },
}))
vi.mock('@/hooks/dataset/artifact/use-artifact-boxplot', () => ({
  useArtifactBoxplot: () => ({ boxplot: null, loading: false, error: null }),
}))
vi.mock('@/hooks/dataset/artifact/use-artifact-validation-boxplot', () => ({
  useArtifactValidationBoxplot: (_d: unknown, _a: unknown, tags: string[]) => ({
    boxplot: tags.length > 0 ? h.validationBoxplot : null,
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
  useMonthlyHistograms: (
    _leg: unknown,
    tag: string | null,
    months: Array<{ key: string }>,
    enabled: boolean,
  ) => {
    h.monthlyHistArgs.push({ tag, keys: months.map(m => m.key), enabled })
    return {
      results: months.map(m => ({
        month: m,
        // Train is stored scaled to [0,1]; the modal inverts it with 0..100.
        data: histResult(tagHist('T1', 0.1, 0.4)),
        error: null,
      })),
      loading: false,
      error: null,
    }
  },
  useMonthlyBoxplots: (
    _leg: unknown,
    _tag: string | null,
    months: Array<{ key: string }>,
  ) => ({
    results: months.map(m => ({
      month: m,
      data: boxResult(tagBox('T1')),
      error: null,
    })),
    loading: false,
    error: null,
  }),
}))

vi.mock('../../create/components/raw-readings-table', () => ({
  RawReadingsTable: () => <div />,
}))
vi.mock('../../create/components/chart/tag-correlation-chart', () => ({
  TagCorrelationChart: () => <div />,
}))
vi.mock('../../create/components/chart/tag-histogram-chart', () => ({
  TagHistogramChart: (props: {
    tags: string[]
    status: string
    data: { domain_min: number | null; domain_max: number | null } | null
    seriesStyle?: (t: string) => { color: string; dashed?: boolean }
  }) => (
    <div
      data-testid="hist"
      data-tags={JSON.stringify(props.tags)}
      data-status={props.status}
      data-domain={JSON.stringify([
        props.data?.domain_min ?? null,
        props.data?.domain_max ?? null,
      ])}
      data-validation-style={JSON.stringify(props.seriesStyle?.('Validation'))}
    />
  ),
}))
vi.mock('../../create/components/chart/tag-boxplot-chart', () => ({
  TagBoxplotChart: (props: { tags: string[]; status: string }) => (
    <div
      data-testid="box"
      data-tags={JSON.stringify(props.tags)}
      data-status={props.status}
    />
  ),
}))

import { DatasetCompareModal } from '../dataset-compare-modal'

const HOLDOUT = {
  holdoutFrom: '2026-04-01T00:00:00.000Z',
  holdoutTo: '2026-04-30T00:00:00.000Z',
  rowCount: 50,
  missingPct: 0,
}

/** Mounted CLOSED, then opened — as the app does. The modal picks its
 * default tag on the closed → open transition, so mounting it already open
 * would leave the selection empty and test a state the app never reaches. */
function renderModal() {
  const props = {
    onOpenChange: () => {},
    datasetId: 'ds-1',
    artifactId: 'art-1',
    availableTags: ['T1'],
    holdout: HOLDOUT,
  }
  const view = render(<DatasetCompareModal open={false} {...props} />)
  view.rerender(<DatasetCompareModal open {...props} />)
  return view
}

const tagsOf = (testId: string): string[] =>
  JSON.parse(screen.getByTestId(testId).getAttribute('data-tags') ?? '[]')

beforeEach(() => {
  h.trainHistTags.length = 0
  h.validationHistTags.length = 0
  h.monthlyHistArgs.length = 0
  // Validation is stored raw (engineering units) — not inverted.
  h.validationHistogram = histResult(tagHist('T1', 5, 80))
  h.validationBoxplot = boxResult(tagBox('T1'))
})

describe('DatasetCompareModal — By month (Histogram / Box Plot)', () => {
  it('offers By side / By month only on the chart tabs that compare', async () => {
    const user = userEvent.setup()
    renderModal()

    expect(
      screen.queryByRole('button', { name: 'By month' }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /Histogram/ }))

    expect(screen.getByRole('button', { name: 'By side' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'By month' })).toBeInTheDocument()
  })

  it('draws Validation first, then the latest two training months', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.click(screen.getByRole('tab', { name: /Histogram/ }))
    await user.click(screen.getByRole('button', { name: 'By month' }))

    expect(tagsOf('hist')).toEqual(['Validation', 'Feb 2026', 'Mar 2026'])
    expect(screen.getByTestId('hist')).toHaveAttribute('data-status', 'ready')
    // Neutral and dashed — never one of the month palette colours.
    expect(
      JSON.parse(
        screen.getByTestId('hist').getAttribute('data-validation-style') ??
          '{}',
      ),
    ).toEqual({ color: 'var(--foreground)', dashed: true })
  })

  it('widens the domain to cover both the validation and the inverted months', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.click(screen.getByRole('tab', { name: /Histogram/ }))
    await user.click(screen.getByRole('button', { name: 'By month' }))

    // Months come back scaled (0.1..0.4) and are inverted with min 0 / max
    // 100 → 10..40; validation is raw 5..80. Domain = 5..80.
    expect(
      JSON.parse(
        screen.getByTestId('hist').getAttribute('data-domain') ?? '[]',
      ),
    ).toEqual([5, 80])
  })

  it('stops the side-by-side train request and asks validation for the one tag', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.click(screen.getByRole('tab', { name: /Histogram/ }))
    h.trainHistTags.length = 0
    h.validationHistTags.length = 0

    await user.click(screen.getByRole('button', { name: 'By month' }))

    expect(h.trainHistTags.at(-1)).toEqual([])
    expect(h.validationHistTags.at(-1)).toEqual(['T1'])
    expect(h.monthlyHistArgs.at(-1)).toMatchObject({
      tag: 'T1',
      keys: ['2026-02', '2026-03'],
      enabled: true,
    })
  })

  it('names the gap instead of drawing months alone when validation has no series', async () => {
    h.validationHistogram = histResult()
    const user = userEvent.setup()
    renderModal()
    await user.click(screen.getByRole('tab', { name: /Histogram/ }))
    await user.click(screen.getByRole('button', { name: 'By month' }))

    expect(tagsOf('hist')).toEqual(['Feb 2026', 'Mar 2026'])
    expect(
      screen.getByText(/No Validation series — the holdout has no usable/),
    ).toBeInTheDocument()
  })

  it('says Histogram heights are counts, and how many rows Validation stands for', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.click(screen.getByRole('tab', { name: /Histogram/ }))
    await user.click(screen.getByRole('button', { name: 'By month' }))

    expect(
      screen.getByText(
        /Heights are counts, not normalised: Validation \(50 rows\)/,
      ),
    ).toBeInTheDocument()
  })

  it('Box Plot compares the same way', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.click(screen.getByRole('tab', { name: /Box Plot/ }))
    await user.click(screen.getByRole('button', { name: 'By month' }))

    expect(tagsOf('box')).toEqual(['Validation', 'Feb 2026', 'Mar 2026'])
  })

  it('keeps the original train-vs-validation view when By side is chosen', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.click(screen.getByRole('tab', { name: /Histogram/ }))

    // Default is By side: the train request is live for the selected tag.
    expect(h.trainHistTags.at(-1)).toEqual(['T1'])
    expect(h.monthlyHistArgs.every(a => !a.enabled)).toBe(true)
  })
})
