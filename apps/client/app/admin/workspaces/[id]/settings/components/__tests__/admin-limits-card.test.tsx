import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ update: vi.fn() }))

vi.mock('@/services/workspace', () => ({
  workspaceService: { adminUpdateWorkspaceLimits: h.update },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { AdminLimitsCard } from '../admin-limits-card'

function renderCard(
  limits = {
    maxModels: null as number | null,
    maxMembers: null as number | null,
  },
) {
  const onSaved = vi.fn()
  render(
    <AdminLimitsCard
      workspaceId="ws-1"
      limits={limits}
      usage={{ models: 8, members: 3 }}
      onSaved={onSaved}
    />,
  )
  return { onSaved }
}

describe('AdminLimitsCard (MODEL-SERVE-035)', () => {
  beforeEach(() => {
    h.update
      .mockReset()
      .mockImplementation((_id, body) =>
        Promise.resolve({ data: { ...body, usage: {} } }),
      )
  })

  it('shows blank (No limit) for a workspace with no caps, and Save starts disabled', () => {
    renderCard()
    expect(screen.getByLabelText('Max models')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Save limits' })).toBeDisabled()
  })

  it('notes a cap below the current count but still saves it', async () => {
    const { onSaved } = renderCard()
    await userEvent.type(screen.getByLabelText('Max models'), '5')
    expect(screen.getByText(/8 of 5: over the limit/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Save limits' }))
    expect(h.update).toHaveBeenCalledWith('ws-1', {
      maxModels: 5,
      maxMembers: null,
    })
    expect(onSaved).toHaveBeenCalledWith({ maxModels: 5, maxMembers: null })
  })

  it('clearing a field sends null (no limit)', async () => {
    renderCard({ maxModels: 10, maxMembers: 4 })
    await userEvent.clear(screen.getByLabelText('Max members'))
    await userEvent.click(screen.getByRole('button', { name: 'Save limits' }))
    expect(h.update).toHaveBeenCalledWith('ws-1', {
      maxModels: 10,
      maxMembers: null,
    })
  })

  it('blocks Save on an invalid number and says why', async () => {
    renderCard()
    await userEvent.type(screen.getByLabelText('Max members'), '0')
    expect(
      screen.getByText('Enter a whole number from 1 to 10000, or leave blank.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save limits' })).toBeDisabled()
  })
})
