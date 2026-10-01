import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TagCorrelationChart } from '../tag-correlation-chart'
import type { DraftCorrelationResult } from '@/services/dataset-draft'

const data = {
  tags: ['A', 'B', 'C'],
  matrix: [
    [1, 0.95, 0.1],
    [0.95, 1, 0.2],
    [0.1, 0.2, 1],
  ],
  near_constant_tags: [],
} as unknown as DraftCorrelationResult

describe('TagCorrelationChart', () => {
  it('opens a strong pair with the first tag on Y and its partner on X', () => {
    const onSelectPair = vi.fn()
    render(
      <TagCorrelationChart
        data={data}
        status="ready"
        onSelectPair={onSelectPair}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /A\s*↔\s*B/ }))
    expect(onSelectPair).toHaveBeenCalledWith({ x: 'B', y: 'A' })
  })

  it('lists only strong pairs while no tag is focused', () => {
    render(
      <TagCorrelationChart data={data} status="ready" onSelectPair={vi.fn()} />,
    )
    expect(screen.getByText('1 pair')).toBeInTheDocument()
  })

  it('keeps the server column order by default and clusters on request', () => {
    const interleaved = {
      tags: ['A', 'B', 'C', 'D'],
      matrix: [
        [1, 0.05, 0.95, 0.1],
        [0.05, 1, 0.02, 0.9],
        [0.95, 0.02, 1, 0.08],
        [0.1, 0.9, 0.08, 1],
      ],
      near_constant_tags: [],
    } as unknown as DraftCorrelationResult
    render(<TagCorrelationChart data={interleaved} status="ready" />)
    fireEvent.click(screen.getByRole('button', { name: /show full heatmap/i }))

    // Only the <thead> row — the row labels are <th> cells too.
    const headerOrder = () =>
      Array.from(document.querySelectorAll('thead th'))
        .map(th => th.textContent)
        .filter(Boolean)
    expect(headerOrder()).toEqual(['A', 'B', 'C', 'D'])

    fireEvent.click(
      screen.getByRole('button', { name: 'Cluster similar tags' }),
    )
    expect(headerOrder()).toEqual(['A', 'C', 'B', 'D'])
  })

  it('renders static rows when no onSelectPair is supplied', () => {
    render(<TagCorrelationChart data={data} status="ready" />)
    expect(screen.queryByRole('button', { name: /A\s*↔\s*B/ })).toBeNull()
    expect(screen.getByText('A')).toBeInTheDocument()
  })
})
