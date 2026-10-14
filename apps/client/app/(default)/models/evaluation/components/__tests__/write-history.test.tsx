import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  RollbackDryRun,
  WriteBackConfigView,
  WriteBackHistoryItem,
} from '@/services/model-backfill'
import type { UseRollback } from '@/hooks/model/use-rollback'
import type { UseWriteBackConfig } from '@/hooks/model/use-write-back-config'
import type { UseWriteBackHistory } from '@/hooks/model/use-write-back-history'
import type { UseWriteBackBatch } from '@/hooks/model/use-write-back-batch'
import { RollbackDialog } from '../rollback-dialog'
import { WriteHistoryCard } from '../write-history-card'

const useHistory = vi.fn<() => UseWriteBackHistory>()
const useConfig = vi.fn<() => UseWriteBackConfig>()
const useRb = vi.fn<() => UseRollback>()
const useBatch = vi.fn<() => UseWriteBackBatch>()
vi.mock('@/hooks/model/use-write-back-history', () => ({
  useWriteBackHistory: () => useHistory(),
}))
vi.mock('@/hooks/model/use-write-back-config', () => ({
  useWriteBackConfig: () => useConfig(),
}))
vi.mock('@/hooks/model/use-rollback', () => ({ useRollback: () => useRb() }))
vi.mock('@/hooks/model/use-write-back-batch', () => ({
  useWriteBackBatch: () => useBatch(),
}))

const T = '2026-10-14T00:00:00.000Z'

const item = (
  over: Partial<WriteBackHistoryItem> = {},
): WriteBackHistoryItem => ({
  id: 'aaaaaaaa-1111',
  kind: 'PREDICTION',
  tag: 'OUT.PRED',
  status: 'SUCCEEDED',
  pointCount: 3,
  okCount: 3,
  failedCount: 0,
  rangeFrom: T,
  rangeTo: '2026-10-14T01:00:00.000Z',
  modelVersionId: null,
  rollbackOfId: null,
  piAccount: 'svc',
  error: null,
  createdAt: T,
  finishedAt: T,
  createdBy: 'Pat Owner',
  ...over,
})

const history = (
  over: Partial<UseWriteBackHistory> = {},
): UseWriteBackHistory => ({
  batches: [item()],
  loading: false,
  loadingMore: false,
  error: null,
  hasMore: false,
  loadMore: vi.fn().mockResolvedValue(undefined),
  ...over,
})

const cfg = (canWrite: boolean): UseWriteBackConfig => ({
  view: { canWrite } as WriteBackConfigView,
  loading: false,
  error: null,
  save: vi.fn(),
})

const rb = (over: Partial<UseRollback> = {}): UseRollback => ({
  target: null,
  plan: null,
  checking: false,
  rolling: false,
  force: false,
  error: null,
  canProceed: false,
  prepare: vi.fn().mockResolvedValue(undefined),
  setForce: vi.fn(),
  confirm: vi.fn().mockResolvedValue(undefined),
  cancel: vi.fn(),
  ...over,
})

const plan = (over: Partial<RollbackDryRun> = {}): RollbackDryRun => ({
  dryRun: true,
  original: {
    id: 'aaaaaaaa-1111',
    kind: 'PREDICTION',
    tag: 'OUT.PRED',
    status: 'SUCCEEDED',
    pointCount: 3,
  },
  tag: 'OUT.PRED',
  piAccount: 'svc',
  replaceCount: 2,
  removeCount: 1,
  skipCount: 0,
  blockedCount: 0,
  driftCount: 0,
  drift: [],
  blockedBy: null,
  canProceed: true,
  canForce: false,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  useHistory.mockReturnValue(history())
  useConfig.mockReturnValue(cfg(true))
  useRb.mockReturnValue(rb())
  useBatch.mockReturnValue({ detail: null, loading: false, error: null })
})

describe('WriteHistoryCard', () => {
  it('lists a batch in plant time with its status in words', () => {
    render(<WriteHistoryCard modelId="m1" refreshKey={0} />)
    expect(screen.getByText('Oct 14, 2026 07:00')).toBeInTheDocument()
    expect(screen.getByText('Pat Owner')).toBeInTheDocument()
    expect(screen.getByText('Predictions')).toBeInTheDocument()
    expect(screen.getByText('OUT.PRED')).toBeInTheDocument()
    expect(screen.getByText('Succeeded')).toBeInTheDocument()
    expect(screen.getByText('3 / 3')).toBeInTheDocument()
  })

  it('says so when nothing has been written', () => {
    useHistory.mockReturnValue(history({ batches: [] }))
    render(<WriteHistoryCard modelId="m1" refreshKey={0} />)
    expect(screen.getByText(/Nothing has been written/)).toBeInTheDocument()
  })

  it('opens the rollback dialog for the row', async () => {
    const prepare = vi.fn().mockResolvedValue(undefined)
    useRb.mockReturnValue(rb({ prepare }))
    render(<WriteHistoryCard modelId="m1" refreshKey={0} />)
    await userEvent.click(screen.getByRole('button', { name: /Roll back/ }))
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'aaaaaaaa-1111' }),
    )
  })

  it('disables Roll back for a non-owner and says why', () => {
    useConfig.mockReturnValue(cfg(false))
    render(<WriteHistoryCard modelId="m1" refreshKey={0} />)
    expect(screen.getByRole('button', { name: /Roll back/ })).toBeDisabled()
    expect(screen.getByText(/owner or an admin/)).toBeInTheDocument()
  })

  it('disables Roll back on a rolled-back batch and on a rollback row', () => {
    useHistory.mockReturnValue(
      history({
        batches: [
          item({ id: 'b-undone', status: 'ROLLED_BACK' }),
          item({ id: 'b-rb', kind: 'ROLLBACK', rollbackOfId: 'b-undone' }),
        ],
      }),
    )
    render(<WriteHistoryCard modelId="m1" refreshKey={0} />)
    for (const b of screen.getAllByRole('button', { name: /Roll back/ })) {
      expect(b).toBeDisabled()
    }
    expect(screen.getByText('Already rolled back.')).toBeInTheDocument()
    expect(screen.getByText(/cannot be rolled back/)).toBeInTheDocument()
  })

  it('expands a row to its before / sent / after values', async () => {
    useBatch.mockReturnValue({
      loading: false,
      error: null,
      detail: {
        batch: { ...item(), rollbacks: [] },
        values: [
          {
            timestamp: T,
            beforeExisted: false,
            beforeValue: null,
            sentValue: 10,
            afterValue: 10,
            itemOk: true,
            itemError: null,
          },
          {
            timestamp: '2026-10-14T00:01:00.000Z',
            beforeExisted: true,
            beforeValue: 4,
            sentValue: 11,
            afterValue: 4,
            itemOk: false,
            itemError: 'PI kept the old value',
          },
        ],
      },
    })
    render(<WriteHistoryCard modelId="m1" refreshKey={0} />)
    await userEvent.click(screen.getByRole('button', { name: /Show values/ }))
    const rows = screen.getAllByRole('row')
    const first = within(
      rows.find(
        r =>
          r.textContent?.includes('07:00') &&
          r.textContent.includes('Verified'),
      )!,
    )
    expect(first.getAllByText('none')).toHaveLength(1)
    expect(screen.getByText('PI kept the old value')).toBeInTheDocument()
  })

  it('pages older history', async () => {
    const loadMore = vi.fn().mockResolvedValue(undefined)
    useHistory.mockReturnValue(history({ hasMore: true, loadMore }))
    render(<WriteHistoryCard modelId="m1" refreshKey={0} />)
    await userEvent.click(screen.getByRole('button', { name: 'Load older' }))
    expect(loadMore).toHaveBeenCalled()
  })
})

describe('RollbackDialog', () => {
  const open = (over: Partial<UseRollback>) =>
    render(<RollbackDialog rollback={rb({ target: item(), ...over })} />)

  it('is closed with no target', () => {
    render(<RollbackDialog rollback={rb()} />)
    expect(screen.queryByText('Roll back this write?')).toBeNull()
  })

  it('shows what will be restored and removed, and the PI account', () => {
    open({ plan: plan(), canProceed: true })
    expect(screen.getByText('Roll back this write?')).toBeInTheDocument()
    expect(
      screen.getByText(/restored to their earlier value/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/removed \(PI had no value there before\)/),
    ).toBeInTheDocument()
    expect(screen.getByText('svc')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Roll back' })).toBeEnabled()
  })

  it('a later overlapping write blocks with no override', () => {
    open({
      plan: plan({
        canProceed: false,
        driftCount: 1,
        blockedBy: {
          id: 'bbbbbbbb-2222',
          kind: 'LAB',
          status: 'SUCCEEDED',
          createdAt: T,
          rangeFrom: T,
          rangeTo: T,
        },
      }),
      canProceed: false,
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      /Roll that one back first/,
    )
    expect(screen.getByText(/bbbbbbbb/)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByRole('button', { name: 'Roll back' })).toBeDisabled()
  })

  it('lists drifted points and gates the button on the tick', async () => {
    const setForce = vi.fn()
    open({
      plan: plan({
        driftCount: 2,
        canForce: true,
        canProceed: false,
        drift: [
          { timestamp: T, expected: 10, actual: 99 },
          {
            timestamp: '2026-10-14T00:01:00.000Z',
            expected: 11,
            actual: 'none',
          },
        ],
      }),
      canProceed: false,
      setForce,
    })
    expect(screen.getByText('99')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Roll back' })).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox'))
    expect(setForce).toHaveBeenCalledWith(true)
  })

  it('shows the server refusal inline', () => {
    open({
      plan: plan(),
      canProceed: true,
      error: 'Another write to OUT.PRED is in progress.',
    })
    expect(screen.getByRole('alert')).toHaveTextContent(/in progress/)
  })

  it('confirm calls the hook', async () => {
    const confirm = vi.fn().mockResolvedValue(undefined)
    open({ plan: plan(), canProceed: true, confirm })
    await userEvent.click(screen.getByRole('button', { name: 'Roll back' }))
    expect(confirm).toHaveBeenCalled()
  })
})
