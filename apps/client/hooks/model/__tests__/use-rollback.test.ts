import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { toast } from 'sonner'
import type {
  RollbackDryRun,
  WriteBackBatchSummary,
  WriteBackHistoryItem,
} from '@/services/model-evaluation'
import { useRollback } from '../use-rollback'

const rollbackCall = vi.fn()
vi.mock('@/services/model-evaluation', () => ({
  modelEvaluationService: {
    rollback: (...a: unknown[]) => rollbackCall(...a),
  },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const T = '2026-10-14T01:00:00.000Z'

const batch: WriteBackHistoryItem = {
  id: 'b1',
  kind: 'PREDICTION',
  tag: 'OUT.PRED',
  status: 'SUCCEEDED',
  pointCount: 3,
  okCount: 3,
  failedCount: 0,
  rangeFrom: T,
  rangeTo: T,
  modelVersionId: null,
  rollbackOfId: null,
  piAccount: 'svc',
  error: null,
  createdAt: T,
  finishedAt: T,
  createdBy: 'Owner',
}

const plan = (over: Partial<RollbackDryRun> = {}): RollbackDryRun => ({
  dryRun: true,
  original: {
    id: 'b1',
    kind: 'PREDICTION',
    tag: 'OUT.PRED',
    status: 'SUCCEEDED',
    pointCount: 3,
  },
  tag: 'OUT.PRED',
  piAccount: 'svc',
  replaceCount: 3,
  removeCount: 0,
  skipCount: 0,
  blockedCount: 0,
  driftCount: 0,
  drift: [],
  blockedBy: null,
  canProceed: true,
  canForce: false,
  ...over,
})

const done = (over: Partial<WriteBackBatchSummary> = {}) => ({
  dryRun: false as const,
  batch: { ...batch, kind: 'ROLLBACK' as const, ...over },
  original: batch,
})

beforeEach(() => {
  vi.clearAllMocks()
})

function setup() {
  const onDone = vi.fn()
  const hook = renderHook(() => useRollback({ modelId: 'm1', onDone }))
  return { ...hook, onDone }
}

describe('useRollback', () => {
  it('opens on a dry run and writes nothing', async () => {
    rollbackCall.mockResolvedValueOnce(plan())
    const { result } = setup()

    await act(() => result.current.prepare(batch))

    expect(rollbackCall).toHaveBeenCalledTimes(1)
    expect(rollbackCall).toHaveBeenCalledWith('m1', 'b1', { dryRun: true })
    expect(result.current.target?.id).toBe('b1')
    expect(result.current.plan?.replaceCount).toBe(3)
    expect(result.current.canProceed).toBe(true)
  })

  it('drift needs force; the tick is what the real call sends', async () => {
    rollbackCall.mockResolvedValueOnce(
      plan({ driftCount: 2, canForce: true, canProceed: false }),
    )
    const { result } = setup()
    await act(() => result.current.prepare(batch))
    expect(result.current.canProceed).toBe(false)

    act(() => result.current.setForce(true))
    expect(result.current.canProceed).toBe(true)

    rollbackCall.mockResolvedValueOnce(done({ status: 'SUCCEEDED' }))
    await act(() => result.current.confirm())
    expect(rollbackCall).toHaveBeenLastCalledWith('m1', 'b1', { force: true })
  })

  it('a later overlapping write cannot be forced', async () => {
    rollbackCall.mockResolvedValueOnce(
      plan({
        driftCount: 1,
        canForce: false,
        canProceed: false,
        blockedBy: {
          id: 'b2',
          kind: 'LAB',
          status: 'SUCCEEDED',
          createdAt: T,
          rangeFrom: T,
          rangeTo: T,
        },
      }),
    )
    const { result } = setup()
    await act(() => result.current.prepare(batch))
    act(() => result.current.setForce(true))
    expect(result.current.canProceed).toBe(false)
  })

  it('reports a verified rollback as success and refreshes the history', async () => {
    rollbackCall.mockResolvedValueOnce(plan())
    const { result, onDone } = setup()
    await act(() => result.current.prepare(batch))

    rollbackCall.mockResolvedValueOnce(done({ status: 'SUCCEEDED' }))
    await act(() => result.current.confirm())

    expect(toast.success).toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(result.current.target).toBeNull()
  })

  it('a PARTIAL rollback is an error toast, never success', async () => {
    rollbackCall.mockResolvedValueOnce(plan())
    const { result } = setup()
    await act(() => result.current.prepare(batch))

    rollbackCall.mockResolvedValueOnce(
      done({ status: 'PARTIAL', okCount: 1, error: 'two points failed' }),
    )
    await act(() => result.current.confirm())

    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/Partly rolled back: 1 of 3/),
      expect.objectContaining({ description: 'two points failed' }),
    )
  })

  it('keeps a refusal inside the dialog and re-reads the plan', async () => {
    rollbackCall.mockResolvedValueOnce(plan())
    const { result, onDone } = setup()
    await act(() => result.current.prepare(batch))

    rollbackCall
      .mockRejectedValueOnce(new Error('3 point(s) in PI no longer hold …'))
      .mockResolvedValueOnce(
        plan({ driftCount: 3, canForce: true, canProceed: false }),
      )
    await act(() => result.current.confirm())

    expect(result.current.error).toMatch(/no longer hold/)
    expect(result.current.target?.id).toBe('b1')
    expect(result.current.plan?.driftCount).toBe(3)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('shows the dry-run refusal (already rolled back) and cancel clears it', async () => {
    rollbackCall.mockRejectedValueOnce(
      new Error('This batch has already been rolled back.'),
    )
    const { result } = setup()
    await act(() => result.current.prepare(batch))
    expect(result.current.error).toMatch(/already been rolled back/)
    expect(result.current.plan).toBeNull()
    expect(result.current.canProceed).toBe(false)

    act(() => result.current.cancel())
    expect(result.current.target).toBeNull()
    expect(result.current.error).toBeNull()
  })
})
