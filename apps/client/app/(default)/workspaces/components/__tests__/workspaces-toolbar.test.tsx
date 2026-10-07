import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { WorkspacesToolbar } from '../workspaces-toolbar'
import type { StatusFilter } from '@/lib/workspace-list'

function setup(status: StatusFilter = 'all') {
  const onStatus = vi.fn()
  render(
    <WorkspacesToolbar
      query=""
      onQuery={vi.fn()}
      status={status}
      onStatus={onStatus}
      counts={{ all: 5, attention: 2, normal: 3 }}
    />,
  )
  return { onStatus, radios: screen.getAllByRole('radio') }
}

describe('WorkspacesToolbar status filter (radio pattern)', () => {
  it('is one Tab stop: only the checked option is focusable', () => {
    const { radios } = setup('attention')
    expect(radios.map(r => r.tabIndex)).toEqual([-1, 0, -1])
  })

  it('moves and selects with the arrow keys, wrapping at the ends', () => {
    const { onStatus, radios } = setup('all')
    fireEvent.keyDown(radios[0]!, { key: 'ArrowRight' })
    expect(onStatus).toHaveBeenLastCalledWith('attention')
    expect(document.activeElement).toBe(radios[1])
    fireEvent.keyDown(radios[0]!, { key: 'ArrowLeft' })
    expect(onStatus).toHaveBeenLastCalledWith('normal')
    expect(document.activeElement).toBe(radios[2])
  })

  it('ignores other keys', () => {
    const { onStatus, radios } = setup('all')
    fireEvent.keyDown(radios[0]!, { key: 'Enter' })
    expect(onStatus).not.toHaveBeenCalled()
  })

  it('names each option with its count, and an unknown count as unknown', () => {
    setup()
    expect(
      screen.getByRole('radio', { name: 'Needs attention, 2' }),
    ).toBeInTheDocument()
    render(
      <WorkspacesToolbar
        query=""
        onQuery={vi.fn()}
        status="all"
        onStatus={vi.fn()}
        counts={{ all: 5, attention: null, normal: null }}
      />,
    )
    expect(
      screen.getByRole('radio', { name: 'Needs attention, unknown' }),
    ).toBeInTheDocument()
  })
})
