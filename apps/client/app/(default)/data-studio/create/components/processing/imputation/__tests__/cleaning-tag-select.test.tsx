import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CleaningTagSelect } from '../cleaning-tag-select'
import {
  rowStampBounds,
  snapStampIndex,
  stampFromTimestamp,
  wallClockKey,
} from '@/lib/date-stamp'

/** DS-LAKE-032-T07 — the batch tag selector above the Cleaning Pipeline. */
const CANDIDATES = ['A', 'B', 'C']

function open(selected: string[], onChange = vi.fn()) {
  render(
    <CleaningTagSelect
      candidates={CANDIDATES}
      selected={selected}
      onChange={onChange}
      cleanedTags={['C']}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Tags to clean' }))
  return onChange
}

const box = (tag: string) =>
  screen.getByText(tag).closest('label')!.querySelector('button')!

describe('CleaningTagSelect', () => {
  it('reads the batch size against the candidates', () => {
    render(
      <CleaningTagSelect
        candidates={CANDIDATES}
        selected={['A']}
        onChange={vi.fn()}
        cleanedTags={[]}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Tags to clean' }),
    ).toHaveTextContent('1 of 3 selected')
  })

  it('adds a tag in candidate order, not click order', () => {
    const onChange = open(['C'])
    fireEvent.click(box('A'))
    expect(onChange).toHaveBeenCalledWith(['A', 'C'])
  })

  it('removes a ticked tag', () => {
    const onChange = open(['A', 'B'])
    fireEvent.click(box('A'))
    expect(onChange).toHaveBeenCalledWith(['B'])
  })

  it('may empty the batch, like the sidebar', () => {
    const onChange = open(['A'])
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('selects every candidate', () => {
    const onChange = open([])
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }))
    expect(onChange).toHaveBeenCalledWith(CANDIDATES)
  })

  it('marks tags already saved as Cleaned', () => {
    open([])
    expect(screen.getByText('C').closest('label')).toHaveTextContent('Cleaned')
  })
})

describe('rowStampBounds', () => {
  it('spans the first and last reading as picker stamps', () => {
    expect(
      rowStampBounds([
        { timestamp: '2026-01-01 06:00:30' },
        { timestamp: '2026-01-03 17:45:00' },
      ]),
    ).toEqual({ min: '2026-01-01T06:00', max: '2026-01-03T17:45' })
  })

  it('reads an offset timestamp on the Bangkok wall clock', () => {
    expect(stampFromTimestamp('2025-12-31T23:00:00.000Z')).toBe(
      '2026-01-01T06:00',
    )
  })

  it('is null with no rows', () => {
    expect(rowStampBounds([])).toBeNull()
  })
})

describe('snapStampIndex (DS-LAKE-032-T08)', () => {
  const TS = [
    '2026-01-01 06:00:00',
    '2026-01-01 06:30:00',
    '2026-01-01 12:00:30',
    '2026-01-01 18:00:00',
  ]

  it('a start keeps the first reading at or after the stamp', () => {
    expect(snapStampIndex(TS, '2026-01-01T06:10', 'start')).toBe(1)
    expect(snapStampIndex(TS, '2026-01-01T06:30', 'start')).toBe(1)
  })

  it('an end keeps the last reading at or before it, minute-inclusive', () => {
    expect(snapStampIndex(TS, '2026-01-01T12:00', 'end')).toBe(2)
    expect(snapStampIndex(TS, '2026-01-01T11:59', 'end')).toBe(1)
  })

  it('clamps a stamp beyond every reading to the nearest end', () => {
    expect(snapStampIndex(TS, '2027-01-01T00:00', 'start')).toBe(3)
    expect(snapStampIndex(TS, '2025-01-01T00:00', 'end')).toBe(0)
  })

  it('is -1 for no readings', () => {
    expect(snapStampIndex([], '2026-01-01T00:00', 'start')).toBe(-1)
  })
})

describe('wallClockKey (DS-LAKE-032-T08)', () => {
  it('orders a saved ISO-Z bound against a naive fetched row correctly', () => {
    // 23:00Z on Dec 31 is 06:00 on Jan 1 in Bangkok.
    expect(wallClockKey('2025-12-31T23:00:00.000Z')).toBe('2026-01-01 06:00:00')
    expect(
      wallClockKey('2026-01-01 05:00:00') <
        wallClockKey('2025-12-31T23:00:00.000Z'),
    ).toBe(true)
  })

  it('treats the T and space forms of one instant as equal', () => {
    expect(wallClockKey('2026-01-01T06:00:00')).toBe(
      wallClockKey('2026-01-01 06:00:00'),
    )
  })
})
