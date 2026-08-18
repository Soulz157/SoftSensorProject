import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { RawReadingsTable } from '../raw-readings-table'
import type { Dataset } from '@/lib/preprocessing'

/**
 * DS-LAKE-005B-A-V02 / DS-LAKE-005B-B-V02: confirms mounted DOM row AND
 * column counts stay within the virtualization window rather than every
 * row/column mounting, on a synthetic 8,000-tag dataset — the literal
 * scenario the verification item names.
 *
 * jsdom has no real layout engine: @tanstack/react-virtual's FIRST size
 * measurement (@tanstack/virtual-core's `getRect`) reads
 * `element.offsetWidth`/`offsetHeight` synchronously, and jsdom hardcodes
 * both to 0 regardless of CSS (confirmed by reading virtual-core's own
 * source, not assumed — `getBoundingClientRect` is NOT what it uses).
 * Without overriding these two properties the virtualizer computes a 0-size
 * visible range and mounts NOTHING, which would make this test pass for the
 * wrong reason (an empty table is technically "bounded"). Overridden here to
 * a realistic viewport (800×384, matching `max-h-96`) so the assertion is
 * genuinely about windowing, not an accidental empty state.
 */

function bigDataset(tagCount: number, rowCount: number): Dataset {
  const tags = Array.from({ length: tagCount }, (_, i) => `TI-${i}`)
  const rows = Array.from({ length: rowCount }, (_, r) => ({
    timestamp: `2026-06-22 00:${String(r).padStart(2, '0')}:00`,
    cells: Object.fromEntries(
      tags.map(tag => [tag, { value: r, status: 'Good' as const }]),
    ),
  }))
  return { tags, rows }
}

describe('RawReadingsTable virtualization (DS-LAKE-005B-B-T02)', () => {
  let widthSpy: ReturnType<typeof vi.spyOn>
  let heightSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    widthSpy = vi
      .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
      .mockReturnValue(800)
    heightSpy = vi
      .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockReturnValue(384)
  })

  afterEach(() => {
    widthSpy.mockRestore()
    heightSpy.mockRestore()
  })

  it('mounts far fewer than 8,000 column cells for an 8,000-tag dataset', () => {
    const dataset = bigDataset(8_000, 50)
    const { container } = render(<RawReadingsTable dataset={dataset} />)

    const columnHeaders = container.querySelectorAll('[role="columnheader"]')
    // 1 sticky "Timestamp" header + a bounded window of tag headers —
    // nowhere near 8,001 (1 + 8,000 tags).
    expect(columnHeaders.length).toBeGreaterThan(1)
    expect(columnHeaders.length).toBeLessThan(200)
  })

  it('mounts far fewer than 50 rows for a 50-row dataset with a short viewport', () => {
    const dataset = bigDataset(8_000, 50)
    const { container } = render(<RawReadingsTable dataset={dataset} />)

    const rows = container.querySelectorAll('[role="row"]')
    // 1 header row + a bounded window of body rows — not all 50.
    expect(rows.length).toBeGreaterThan(1)
    expect(rows.length).toBeLessThan(50)
  })

  it('mounted cell count is bounded, not O(tags × rows)', () => {
    const dataset = bigDataset(8_000, 200)
    const { container } = render(<RawReadingsTable dataset={dataset} />)

    const cells = container.querySelectorAll('[role="cell"]')
    // O(tags × rows) for this fixture would be 1,600,000 cells. A windowed
    // render with a small viewport and modest overscan is a few hundred at
    // most — asserting a generous but genuinely discriminating ceiling.
    expect(cells.length).toBeLessThan(2_000)
  })

  it('renders the correct tag values for the columns that ARE mounted', () => {
    // Small enough that every column mounts, so the content itself — not
    // just the count — is checked against real values.
    const dataset = bigDataset(3, 2)
    const { getByText } = render(<RawReadingsTable dataset={dataset} />)

    expect(getByText('TI-0')).toBeInTheDocument()
    expect(getByText('TI-1')).toBeInTheDocument()
    expect(getByText('TI-2')).toBeInTheDocument()
  })

  it('windows on scroll — the mounted tag columns actually change, not just their count', () => {
    // A count-only assertion at scroll position zero would pass even for a
    // broken windower that always renders the SAME first N columns (wrong
    // `start` offsets, stale range). Scrolling and checking identity is what
    // proves this is windowing, not just an initial bounded render.
    const dataset = bigDataset(8_000, 50)
    const { container, queryByText } = render(
      <RawReadingsTable dataset={dataset} />,
    )
    expect(queryByText('TI-0')).toBeInTheDocument()

    const scrollEl = container.querySelector('[role="table"]') as HTMLElement
    // 5,000px at TAG_COL_WIDTH=160 is ~31 columns in — far past the initial
    // overscanned window, so TI-0 should no longer be mounted.
    Object.defineProperty(scrollEl, 'scrollLeft', {
      value: 5_000,
      writable: true,
    })
    scrollEl.dispatchEvent(new Event('scroll'))

    expect(queryByText('TI-0')).not.toBeInTheDocument()
    expect(queryByText('TI-31')).toBeInTheDocument()
  })

  it('shows the empty state for zero tags or zero rows without touching the virtualizer', () => {
    const { getByText, rerender } = render(
      <RawReadingsTable dataset={{ tags: [], rows: [] }} />,
    )
    expect(getByText('No rows to display')).toBeInTheDocument()

    rerender(<RawReadingsTable dataset={{ tags: ['TI-0'], rows: [] }} />)
    expect(getByText('No rows to display')).toBeInTheDocument()
  })
})
