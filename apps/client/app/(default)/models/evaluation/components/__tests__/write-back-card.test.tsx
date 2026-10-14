import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { WriteBackConfigView } from '@/services/model-backfill'
import type { UseWriteBack } from '@/hooks/model/use-write-back'
import type { UseWriteBackConfig } from '@/hooks/model/use-write-back-config'
import { WriteBackCard } from '../write-back-card'

const useConfig = vi.fn<() => UseWriteBackConfig>()
const useWrite = vi.fn<() => UseWriteBack>()
vi.mock('@/hooks/model/use-write-back-config', () => ({
  useWriteBackConfig: () => useConfig(),
}))
vi.mock('@/hooks/model/use-write-back', () => ({
  useWriteBack: () => useWrite(),
}))
vi.mock('../write-back-config-dialog', () => ({
  WriteBackConfigDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="config-dialog" /> : null,
}))
vi.mock('../write-back-confirm-dialog', () => ({
  WriteBackConfirmDialog: ({ dryRun }: { dryRun: unknown }) =>
    dryRun ? <div data-testid="confirm-dialog" /> : null,
}))

const view = (
  over: Partial<WriteBackConfigView> = {},
): WriteBackConfigView => ({
  config: {
    sourceId: 's',
    predictionTag: 'OUT.PRED',
    labTag: null,
    updatedAt: '2026-10-14T00:00:00.000Z',
  },
  canWrite: true,
  source: {
    id: 's',
    name: 'Plant PI',
    type: 'aveva',
    piAccount: 'svc-softsensor',
    writable: true,
  },
  sourceChanged: false,
  targetTag: 'LAB.Y',
  ...over,
})

const write = (over: Partial<UseWriteBack> = {}): UseWriteBack => ({
  blockerFor: () => null,
  pending: null,
  preparing: null,
  writing: false,
  prepare: vi.fn().mockResolvedValue(undefined),
  confirm: vi.fn().mockResolvedValue(undefined),
  cancel: vi.fn(),
  ...over,
})

function renderCard() {
  render(
    <WriteBackCard modelId="m1" data={null} labRows={[]} onWritten={vi.fn()} />,
  )
}

beforeEach(() => {
  useConfig.mockReset()
  useWrite.mockReset()
})

describe('WriteBackCard', () => {
  it('shows the account a write is attributed to and the configured tags', () => {
    useConfig.mockReturnValue({
      view: view(),
      loading: false,
      error: null,
      save: vi.fn(),
    })
    useWrite.mockReturnValue(write())
    renderCard()
    expect(
      screen.getByText(/Plant PI · written as svc-softsensor/),
    ).toBeInTheDocument()
    expect(screen.getByText('OUT.PRED')).toBeInTheDocument()
    expect(screen.getByText('Not set')).toBeInTheDocument() // lab tag
  })

  it('each button asks the hook to prepare its own kind', async () => {
    const prepare = vi.fn().mockResolvedValue(undefined)
    useConfig.mockReturnValue({
      view: view(),
      loading: false,
      error: null,
      save: vi.fn(),
    })
    useWrite.mockReturnValue(write({ prepare }))
    renderCard()
    await userEvent.click(
      screen.getByRole('button', { name: 'Write predictions to PI' }),
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Write lab values to PI' }),
    )
    expect(prepare).toHaveBeenNthCalledWith(1, 'PREDICTION')
    expect(prepare).toHaveBeenNthCalledWith(2, 'LAB')
  })

  it('a blocked kind is disabled and the reason is on screen in words', () => {
    useConfig.mockReturnValue({
      view: view(),
      loading: false,
      error: null,
      save: vi.fn(),
    })
    useWrite.mockReturnValue(
      write({
        blockerFor: k => (k === 'LAB' ? 'Set the lab output tag first.' : null),
      }),
    )
    renderCard()
    expect(
      screen.getByRole('button', { name: 'Write lab values to PI' }),
    ).toBeDisabled()
    expect(
      screen.getByText('Set the lab output tag first.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Write predictions to PI' }),
    ).toBeEnabled()
  })

  it('someone who may not write sees disabled controls and why, not a hidden card', () => {
    useConfig.mockReturnValue({
      view: view({ canWrite: false }),
      loading: false,
      error: null,
      save: vi.fn(),
    })
    useWrite.mockReturnValue(
      write({
        blockerFor: () => 'Only a workspace owner or an admin can write to PI.',
      }),
    )
    renderCard()
    expect(screen.getByRole('button', { name: /output tags/ })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Write predictions to PI' }),
    ).toBeDisabled()
    expect(screen.getAllByText(/owner or an admin/).length).toBeGreaterThan(0)
  })

  it('a non-PI source cannot have output tags set', () => {
    useConfig.mockReturnValue({
      view: view({
        source: {
          id: 's',
          name: 'DB',
          type: 'sql',
          piAccount: 'u',
          writable: false,
        },
      }),
      loading: false,
      error: null,
      save: vi.fn(),
    })
    useWrite.mockReturnValue(write())
    renderCard()
    expect(screen.getByRole('button', { name: /output tags/ })).toBeDisabled()
  })

  it('the button says Set when nothing is configured, Edit when something is', () => {
    useConfig.mockReturnValue({
      view: view({ config: null }),
      loading: false,
      error: null,
      save: vi.fn(),
    })
    useWrite.mockReturnValue(write())
    renderCard()
    expect(
      screen.getByRole('button', { name: 'Set output tags' }),
    ).toBeInTheDocument()
  })

  it('opens the config dialog', async () => {
    useConfig.mockReturnValue({
      view: view(),
      loading: false,
      error: null,
      save: vi.fn(),
    })
    useWrite.mockReturnValue(write())
    renderCard()
    await userEvent.click(
      screen.getByRole('button', { name: 'Edit output tags' }),
    )
    expect(screen.getByTestId('config-dialog')).toBeInTheDocument()
  })

  it('shows the confirm dialog when a dry run is pending', () => {
    useConfig.mockReturnValue({
      view: view(),
      loading: false,
      error: null,
      save: vi.fn(),
    })
    useWrite.mockReturnValue(
      write({ pending: { dryRun: true } as UseWriteBack['pending'] }),
    )
    renderCard()
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument()
  })

  it('shows a transport error instead of an empty card', () => {
    useConfig.mockReturnValue({
      view: null,
      loading: false,
      error: 'Forbidden: monitoring access required',
      save: vi.fn(),
    })
    useWrite.mockReturnValue(write())
    renderCard()
    expect(
      screen.getByText('Forbidden: monitoring access required'),
    ).toBeInTheDocument()
  })

  it('shows a skeleton, not an error, while the first read is in flight', () => {
    useConfig.mockReturnValue({
      view: null,
      loading: true,
      error: null,
      save: vi.fn(),
    })
    useWrite.mockReturnValue(write())
    renderCard()
    expect(screen.queryByText(/unavailable/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('disables both writes while a dry run is in flight', () => {
    useConfig.mockReturnValue({
      view: view(),
      loading: false,
      error: null,
      save: vi.fn(),
    })
    useWrite.mockReturnValue(write({ preparing: 'LAB' }))
    renderCard()
    expect(
      screen.getByRole('button', { name: 'Write predictions to PI' }),
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled()
  })
})
