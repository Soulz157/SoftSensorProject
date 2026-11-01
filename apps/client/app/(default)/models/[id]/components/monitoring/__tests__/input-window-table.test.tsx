import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { InputWindowTable } from '../input-drift/input-window-table'
import type { InputDriftWindow } from '@/services/model-monitoring'

/** Hourly windows, oldest first, so newest-first paging is visible. */
function hourly(count: number): InputDriftWindow[] {
  return Array.from({ length: count }, (_, i) => {
    const start = new Date(Date.UTC(2026, 9, 1, 0, 0) + i * 3_600_000)
    return {
      windowStart: start.toISOString(),
      windowEnd: new Date(start.getTime() + 3_600_000).toISOString(),
      n: 60,
      min: i,
      max: i + 1,
      mean: i + 0.5,
      below: 0,
      above: 0,
    }
  })
}

const bodyRows = () => screen.getAllByRole('row').slice(1)

describe('InputWindowTable paging', () => {
  it('shows one page of 12 at a time instead of growing the list', () => {
    render(<InputWindowTable windows={hourly(30)} unit="window" />)
    expect(bodyRows()).toHaveLength(12)
    expect(screen.getByText('Page 1 of 3')).toBeTruthy()
    expect(screen.getByText('1–12 of 30 windows')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(bodyRows()).toHaveLength(12)
    expect(screen.getByText('13–24 of 30 windows')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '3' }))
    expect(bodyRows()).toHaveLength(6)
    expect(screen.getByText('25–30 of 30 windows')).toBeTruthy()
  })

  it('clamps to the last page when the range shrinks', () => {
    const { rerender } = render(
      <InputWindowTable windows={hourly(30)} unit="window" />,
    )
    fireEvent.click(screen.getByRole('button', { name: '3' }))
    rerender(<InputWindowTable windows={hourly(20)} unit="window" />)
    expect(bodyRows()).toHaveLength(8)
    expect(screen.getByText('13–20 of 20 windows')).toBeTruthy()
  })

  it('has no pager when everything fits on one page', () => {
    render(<InputWindowTable windows={hourly(10)} unit="hour" />)
    expect(bodyRows()).toHaveLength(10)
    expect(screen.queryByRole('button', { name: /next/i })).toBeNull()
  })
})
