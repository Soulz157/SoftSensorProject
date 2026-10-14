import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  addLabRow,
  editLabRow,
  removeLabRow,
  seedLab,
} from '@/lib/backfill-lab'
import { LabEditor } from '../lab-editor'

const T1 = '2026-10-14T01:00:00.000Z' // 08:00 plant time
const T2 = '2026-10-14T02:00:00.000Z'

function renderEditor(
  rows = seedLab([
    { t: T1, value: 1.5 },
    { t: T2, value: 2 },
  ]),
  over = {},
) {
  const props = {
    rows,
    changes: 0,
    pairedCount: 2,
    rangeFrom: '2026-10-14T00:00',
    rangeTo: '2026-10-14T23:59',
    onAdd: vi.fn(),
    onEdit: vi.fn(),
    onRemove: vi.fn(),
    onRestore: vi.fn(),
    onCsv: vi.fn(() => ({ added: 0, errors: [] })),
    onReset: vi.fn(),
    ...over,
  }
  render(<LabEditor {...props} />)
  return props
}

describe('LabEditor', () => {
  it('lists the imported lab values with their source, in plant time', () => {
    renderEditor()
    expect(screen.getAllByText('Imported')).toHaveLength(2)
    expect(
      screen.getByLabelText(/Lab value at Oct 14, 2026 08:00/),
    ).toHaveValue(1.5)
    expect(
      screen.getByText(/2 in use · 2 paired with a prediction/),
    ).toBeInTheDocument()
  })

  it('says so when the source recorded no lab values', () => {
    renderEditor([])
    expect(
      screen.getByText(/recorded no lab values in this range/),
    ).toBeInTheDocument()
  })

  it('committing a changed value calls onEdit with the row and the number', async () => {
    const p = renderEditor()
    const input = screen.getByLabelText(/Lab value at Oct 14, 2026 08:00/)
    await userEvent.clear(input)
    await userEvent.type(input, '9.25')
    await userEvent.tab()
    expect(p.onEdit).toHaveBeenCalledWith(T1, 9.25)
  })

  it('leaving a value unchanged, or blank, does not edit', async () => {
    const p = renderEditor()
    const input = screen.getByLabelText(/Lab value at Oct 14, 2026 08:00/)
    await userEvent.click(input)
    await userEvent.tab()
    await userEvent.clear(input)
    await userEvent.tab()
    expect(p.onEdit).not.toHaveBeenCalled()
  })

  it('Enter commits', async () => {
    const p = renderEditor()
    const input = screen.getByLabelText(/Lab value at Oct 14, 2026 08:00/)
    await userEvent.clear(input)
    await userEvent.type(input, '4{Enter}')
    expect(p.onEdit).toHaveBeenCalledWith(T1, 4)
  })

  it('an edited row shows the source value it replaced, and a label (not just colour)', () => {
    renderEditor(editLabRow(seedLab([{ t: T1, value: 1.5 }]), T1, 9), {
      changes: 1,
    })
    expect(screen.getByText('Edited')).toBeInTheDocument()
    expect(screen.getByText('source: 1.5')).toBeInTheDocument()
  })

  it('an added row is labelled Added', () => {
    renderEditor(addLabRow([], { timestamp: T1, value: 3 }), { changes: 1 })
    expect(screen.getByText('Added')).toBeInTheDocument()
  })

  it('remove calls onRemove for that row', async () => {
    const p = renderEditor()
    await userEvent.click(
      screen.getByRole('button', {
        name: /Remove lab value at Oct 14, 2026 09:00/,
      }),
    )
    expect(p.onRemove).toHaveBeenCalledWith(T2)
  })

  it('a removed row is struck out, disabled, and can be restored', async () => {
    const rows = removeLabRow(seedLab([{ t: T1, value: 1.5 }]), T1)
    const p = renderEditor(rows, { changes: 1 })
    expect(screen.getByText('Removed')).toBeInTheDocument()
    expect(screen.getByLabelText(/Lab value at/)).toBeDisabled()
    await userEvent.click(
      screen.getByRole('button', { name: /Restore lab value at/ }),
    )
    expect(p.onRestore).toHaveBeenCalledWith(T1)
    expect(screen.getByText(/0 in use/)).toBeInTheDocument()
  })

  it('Reset appears only once something has changed', () => {
    renderEditor()
    expect(
      screen.queryByRole('button', { name: /Reset to source/ }),
    ).not.toBeInTheDocument()
  })

  it('Reset to source calls onReset', async () => {
    const p = renderEditor(undefined, { changes: 2 })
    await userEvent.click(
      screen.getByRole('button', { name: /Reset to source/ }),
    )
    expect(p.onReset).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/2 changed from the source/)).toBeInTheDocument()
  })

  it('Add point without a timestamp or value adds nothing', async () => {
    const p = renderEditor()
    await userEvent.click(screen.getByRole('button', { name: /Add point/ }))
    expect(p.onAdd).not.toHaveBeenCalled()
  })

  it('every row has an accessible name', () => {
    renderEditor()
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('spinbutton')).toHaveLength(2)
  })
})
