import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { HYPERPARAMS } from '@/lib/training-config'
import { ALGORITHM_LABELS, type Algorithm } from '@/store/model-pipeline'
import type { DatasetSize } from '@/lib/hyperparam-ranges'
import type { TuningGridResponse } from '@/services/tuning-grid'
import {
  TUNE_VARIANTS_PER_JOB,
  tuningVariantsFor,
} from '../../../../../../../../../backend/src/lib/tuning-grid'
import { VariantPreview } from '../variant-preview'

vi.mock('@/hooks/model/use-tuning-grid', () => ({ useTuningGrid: vi.fn() }))
import { useTuningGrid } from '@/hooks/model/use-tuning-grid'

function gridFor(
  algorithm: Algorithm,
  size?: DatasetSize,
  cap: number = TUNE_VARIANTS_PER_JOB,
): TuningGridResponse {
  return {
    algorithm,
    variants: tuningVariantsFor(algorithm, size),
    maxVariantsPerJob: cap,
    tier: 'medium',
    sized: false,
  }
}

function serve(
  grid: TuningGridResponse | null,
  loading = false,
  error: string | null = null,
) {
  vi.mocked(useTuningGrid).mockReturnValue({ grid, loading, error })
}

function renderPreview(
  algorithm: Algorithm,
  props: {
    base?: Record<string, number | string | boolean | null>
    size?: DatasetSize
    mode?: 'direct' | 'sweep-then-tune'
  } = {},
) {
  return render(
    <VariantPreview
      algorithm={algorithm}
      base={props.base ?? {}}
      size={props.size}
      mode={props.mode ?? 'direct'}
    />,
  )
}

/** Body rows of the variant table, header excluded. */
function bodyRows() {
  const table = screen.getByRole('table')
  return within(table).getAllByRole('row').slice(1)
}

beforeEach(() => {
  vi.mocked(useTuningGrid).mockReset()
})

describe('VariantPreview (MODEL-FLOW-025)', () => {
  it('asks the tuning-grid hook for this algorithm at this dataset size', () => {
    serve(gridFor('ridge'))
    const size = { rows: 400 }
    renderPreview('ridge', { size })
    expect(useTuningGrid).toHaveBeenCalledWith('ridge', size)
  })

  it('direct search: titled "Hyperparameter Tuning", says the current setting runs first, one row per variant', () => {
    serve(gridFor('ridge'))
    renderPreview('ridge', { mode: 'direct' })

    expect(screen.getByText('Hyperparameter Tuning')).toBeInTheDocument()
    expect(
      screen.getByText(
        /trains your current setting first, then each of these/i,
      ),
    ).toBeInTheDocument()
    expect(bodyRows()).toHaveLength(tuningVariantsFor('ridge').length)
  })

  it('sweep then tune: titled "if this wins", and names the algorithm that must win', () => {
    serve(gridFor('xgboost'))
    renderPreview('xgboost', { mode: 'sweep-then-tune' })

    expect(screen.getByText('Hyperparameter Tuning')).toBeInTheDocument()
    expect(
      screen.getByText(
        new RegExp(`only if ${ALGORITHM_LABELS.xgboost} wins`, 'i'),
      ),
    ).toBeInTheDocument()
  })

  it('heads each column with the form’s own label and shows the variant’s values', () => {
    serve(gridFor('xgboost'))
    renderPreview('xgboost')

    const table = screen.getByRole('table')
    for (const key of ['n_estimators', 'learning_rate', 'max_depth']) {
      const label = HYPERPARAMS.xgboost.find(f => f.key === key)!.label
      expect(
        within(table).getByRole('columnheader', { name: label }),
      ).toBeInTheDocument()
    }
    const first = tuningVariantsFor('xgboost')[0]!
    expect(
      within(bodyRows()[0]!).getByText(String(first.n_estimators)),
    ).toBeInTheDocument()
  })

  it('reads null as "unlimited" and a select value as its label', () => {
    serve(gridFor('random_forest'))
    const { unmount } = renderPreview('random_forest')
    expect(screen.getAllByText('unlimited').length).toBeGreaterThan(0)
    unmount()

    serve(gridFor('svm'))
    renderPreview('svm')
    const kernel = HYPERPARAMS.svm.find(f => f.key === 'kernel')!
    if (kernel.kind !== 'select') throw new Error('svm.kernel is not a select')
    const rbf = kernel.options.find(o => o.value === 'rbf')!
    expect(screen.getAllByText(rbf.label).length).toBeGreaterThan(0)
  })

  it('drops the variant the base equals, live, and says so', () => {
    const grid = gridFor('ridge')
    serve(grid)
    renderPreview('ridge', { base: { ...grid.variants[1]! } })

    expect(bodyRows()).toHaveLength(grid.variants.length - 1)
    expect(
      screen.getByText(/1 variant skipped — it equals your current values/i),
    ).toBeInTheDocument()
  })

  it('says nothing is left when the base equals every variant — a refusal for a direct search, a no-op for the tune', () => {
    const grid = gridFor('ols')
    serve(grid)
    const { unmount } = renderPreview('ols', {
      base: { ...grid.variants[0]! },
      mode: 'direct',
    })
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(
      screen.getByText(/nothing left to try.*would have nothing to search/i),
    ).toBeInTheDocument()
    unmount()

    serve(grid)
    renderPreview('ols', {
      base: { ...grid.variants[0]! },
      mode: 'sweep-then-tune',
    })
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(
      screen.getByText(/nothing left to try if this wins/i),
    ).toBeInTheDocument()
  })

  it('shows a loading line, then an error line, and never a table for either', () => {
    serve(null, true)
    const { unmount } = renderPreview('ridge')
    expect(screen.getByText(/loading hyperparameters/i)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    unmount()

    serve(null, false, 'boom')
    renderPreview('ridge')
    expect(
      screen.getByText(/could not load the variants for this algorithm/i),
    ).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('lstm/gru: never shows sequence_length — it is carried, not tuned', () => {
    serve(gridFor('lstm'))
    renderPreview('lstm', { base: { epochs: 1, sequence_length: 48 } })

    expect(screen.queryByText(/sequence.?length/i)).not.toBeInTheDocument()
    expect(bodyRows().length).toBeGreaterThan(0)
  })

  it('shows no more rows than the job’s per-job maximum', () => {
    serve(gridFor('ridge', undefined, 2))
    renderPreview('ridge')
    expect(bodyRows()).toHaveLength(2)
  })

  it('is a collapsible section, open by default, with a named table', () => {
    serve(gridFor('ridge'))
    renderPreview('ridge')

    const details = screen.getByText('Hyperparameter Tuning').closest('details')
    expect(details).not.toBeNull()
    expect(details).toHaveAttribute('open')
    expect(
      screen.getByRole('table', {
        name: `${ALGORITHM_LABELS.ridge} Hyperparameter Tuning`,
      }),
    ).toBeInTheDocument()
  })
})
