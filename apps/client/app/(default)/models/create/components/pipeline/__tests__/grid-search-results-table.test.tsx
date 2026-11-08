import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { RunGridSearch } from '@/services/model-draft'
import { GridSearchResultsTable } from '../model-selection/grid-search-results-table'

/**
 * MODEL-FLOW-038. Step 4's view of the whole search behind a grid-search
 * candidate: every combination, ranked, the winner named in words.
 */
const combo = (
  rank: number,
  alpha: number,
  fitIntercept: boolean,
  mean: number,
) => ({
  rank,
  params: { alpha, fit_intercept: fitIntercept },
  hyperparameters: { alpha, fit_intercept: fitIntercept, solver: 'auto' },
  mean_score: mean,
  std_score: 0.01234567,
  mean_fit_time: 0.5,
})

const SEARCH: RunGridSearch = {
  algorithm: 'ridge',
  ranking_metric: 'rmse',
  cv: true,
  n_folds: 3,
  n_combinations: 3,
  grid: { alpha: [0.1, 1, 10], fit_intercept: [true] },
  best: combo(1, 1, true, 0.4213),
  combinations: [
    combo(1, 1, true, 0.4213),
    combo(2, 0.1, true, 0.45678),
    combo(3, 10, true, 1.23456),
  ],
}

const rows = () => screen.getAllByRole('row').slice(1) // drop the header

describe('GridSearchResultsTable (MODEL-FLOW-038)', () => {
  it('states the count, the ranking metric and what it was scored on', () => {
    render(<GridSearchResultsTable gridSearch={SEARCH} />)
    const title = screen.getByTestId('grid-search-results')
    expect(title).toHaveTextContent('3 combinations')
    expect(title).toHaveTextContent('ranked by RMSE on the 3-fold CV mean')
    expect(title).toHaveTextContent('lower is better')
  })

  it('says "test split" when the search had one chronological fold', () => {
    render(
      <GridSearchResultsTable
        gridSearch={{ ...SEARCH, cv: false, n_folds: 1 }}
      />,
    )
    expect(screen.getByTestId('grid-search-results')).toHaveTextContent(
      'on the test split',
    )
  })

  it('names the metric the search ranked by', () => {
    render(
      <GridSearchResultsTable
        gridSearch={{ ...SEARCH, ranking_metric: 'mae' }}
      />,
    )
    expect(
      screen.getByRole('columnheader', { name: 'MAE' }),
    ).toBeInTheDocument()
  })

  it('lists every combination, best first, with the searched keys as columns', () => {
    render(<GridSearchResultsTable gridSearch={SEARCH} />)
    expect(rows()).toHaveLength(3)
    const first = within(rows()[0]!).getAllByRole('cell')
    // rank, alpha, fit_intercept, score, fit time, result
    expect(first.map(c => c.textContent)).toEqual([
      '1',
      '1',
      'on',
      '0.4213',
      '0.5',
      'Best',
    ])
    expect(
      screen.getByRole('columnheader', { name: 'Alpha (regularization)' }),
    ).toBeInTheDocument()
  })

  it('marks exactly one row Best, in words', () => {
    render(<GridSearchResultsTable gridSearch={SEARCH} />)
    expect(screen.getAllByText('Best')).toHaveLength(1)
    expect(within(rows()[1]!).queryByText('Best')).toBeNull()
  })

  it('prints a score to four significant digits, not a long float', () => {
    render(<GridSearchResultsTable gridSearch={SEARCH} />)
    expect(screen.getByText('0.4568')).toBeInTheDocument()
    expect(screen.getByText('1.235')).toBeInTheDocument()
  })

  it('shows a column for a key the form does not know, under its own name', () => {
    render(
      <GridSearchResultsTable
        gridSearch={{
          ...SEARCH,
          grid: { mystery: [1, 2] },
          combinations: [
            { ...combo(1, 1, true, 0.4), params: { mystery: 2 } },
            { ...combo(2, 1, true, 0.5), params: { mystery: 1 } },
          ],
          best: { ...combo(1, 1, true, 0.4), params: { mystery: 2 } },
        }}
      />,
    )
    expect(
      screen.getByRole('columnheader', { name: 'mystery' }),
    ).toBeInTheDocument()
  })

  it('shows no ± Std column', () => {
    render(<GridSearchResultsTable gridSearch={SEARCH} />)
    expect(screen.queryByRole('columnheader', { name: /std/i })).toBeNull()
  })

  it('highlights the metric column — header and every cell — and nothing else', () => {
    render(<GridSearchResultsTable gridSearch={SEARCH} />)
    const header = screen.getByRole('columnheader', { name: 'RMSE' })
    expect(header).toHaveClass('bg-primary/10', 'font-semibold')
    for (const row of rows()) {
      const cells = within(row).getAllByRole('cell')
      // rank, alpha, fit_intercept, SCORE, fit time, result
      expect(cells[3]).toHaveClass('bg-primary/10', 'font-semibold')
      cells
        .filter((_, i) => i !== 3)
        .forEach(c => expect(c).not.toHaveClass('bg-primary/10'))
    }
  })

  it('highlights whichever metric the job ranked by', () => {
    render(
      <GridSearchResultsTable
        gridSearch={{ ...SEARCH, ranking_metric: 'mae' }}
      />,
    )
    expect(screen.getByRole('columnheader', { name: 'MAE' })).toHaveClass(
      'bg-primary/10',
    )
  })
})
