import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { toast } from 'sonner'
import { seedLab } from '@/lib/backfill-lab'
import type {
  EvaluationCompareResult,
  WriteBackBatchSummary,
  WriteBackConfigView,
  WriteBackDryRun,
} from '@/services/model-backfill'
import { useWriteBack } from '../use-write-back'

const writeBack = vi.fn()
vi.mock('@/services/model-backfill', () => ({
  modelEvaluationService: { writeBack: (...a: unknown[]) => writeBack(...a) },
}))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const T1 = '2026-10-14T01:00:00.000Z'
const T2 = '2026-10-14T02:00:00.000Z'

const data = {
  modelVersionId: 'v1',
  points: [
    { t: T1, predicted: 10, skippedReason: null },
    { t: T2, predicted: null, skippedReason: 'x' },
  ],
} as unknown as EvaluationCompareResult

const view: WriteBackConfigView = {
  config: {
    sourceId: 's',
    predictionTag: 'OUT.PRED',
    labTag: 'OUT.LAB',
    updatedAt: T1,
  },
  canWrite: true,
  source: {
    id: 's',
    name: 'PI',
    type: 'aveva',
    piAccount: 'svc',
    writable: true,
  },
  sourceChanged: false,
  targetTag: 'LAB.Y',
}

const dry = (over: Partial<WriteBackDryRun> = {}): WriteBackDryRun => ({
  dryRun: true,
  kind: 'PREDICTION',
  tag: 'OUT.PRED',
  sourceName: 'PI',
  piAccount: 'svc',
  pointCount: 1,
  overwriteCount: 0,
  newCount: 1,
  busy: false,
  ...over,
})

const batch = (
  over: Partial<WriteBackBatchSummary> = {},
): WriteBackBatchSummary => ({
  id: 'b1',
  kind: 'PREDICTION',
  tag: 'OUT.PRED',
  status: 'SUCCEEDED',
  pointCount: 1,
  okCount: 1,
  failedCount: 0,
  rangeFrom: T1,
  rangeTo: T1,
  modelVersionId: 'v1',
  rollbackOfId: null,
  piAccount: 'svc',
  error: null,
  createdAt: T1,
  finishedAt: T1,
  ...over,
})

const rows = seedLab([{ t: T1, value: 5 }])
const onWritten = vi.fn()

function setup(over: Partial<Parameters<typeof useWriteBack>[0]> = {}) {
  return renderHook(() =>
    useWriteBack({ modelId: 'm1', data, rows, view, onWritten, ...over }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useWriteBack', () => {
  it('prepare asks the server for a DRY RUN with the scored points only, and opens the confirm', async () => {
    writeBack.mockResolvedValue(dry())
    const { result } = setup()

    await act(() => result.current.prepare('PREDICTION'))

    expect(writeBack).toHaveBeenCalledTimes(1)
    expect(writeBack).toHaveBeenCalledWith('m1', {
      kind: 'PREDICTION',
      points: [{ timestamp: T1, value: 10 }], // the unscored row is not sent
      modelVersionId: 'v1',
      dryRun: true,
    })
    expect(result.current.pending).toEqual(dry())
    expect(result.current.preparing).toBeNull()
  })

  it("never sends a tag: the destination is the server's saved config", async () => {
    writeBack.mockResolvedValue(dry())
    const { result } = setup()
    await act(() => result.current.prepare('PREDICTION'))
    expect(Object.keys(writeBack.mock.calls[0]![1] as object)).not.toContain(
      'tag',
    )
  })

  it('a lab write sends the edited series and no model version', async () => {
    writeBack.mockResolvedValue(dry({ kind: 'LAB', tag: 'OUT.LAB' }))
    const { result } = setup()
    await act(() => result.current.prepare('LAB'))
    expect(writeBack).toHaveBeenCalledWith('m1', {
      kind: 'LAB',
      points: [{ timestamp: T1, value: 5 }],
      dryRun: true,
    })
  })

  it('does nothing when the write is blocked', async () => {
    const { result } = setup({ view: { ...view, canWrite: false } })
    await act(() => result.current.prepare('PREDICTION'))
    expect(writeBack).not.toHaveBeenCalled()
    expect(result.current.blockerFor('PREDICTION')).toMatch(/owner or an admin/)
  })

  it('a failed dry run opens no dialog and says why', async () => {
    writeBack.mockRejectedValue(new Error('Another write is in progress'))
    const { result } = setup()
    await act(() => result.current.prepare('PREDICTION'))
    expect(result.current.pending).toBeNull()
    expect(toast.error).toHaveBeenCalledWith('Another write is in progress')
  })

  it('nothing is written until confirm; cancel writes nothing', async () => {
    writeBack.mockResolvedValue(dry())
    const { result } = setup()
    await act(() => result.current.prepare('PREDICTION'))
    act(() => result.current.cancel())
    expect(result.current.pending).toBeNull()
    expect(writeBack).toHaveBeenCalledTimes(1) // only the dry run
  })

  it('confirm performs the real write with dryRun false and reports success', async () => {
    writeBack.mockResolvedValueOnce(dry())
    writeBack.mockResolvedValueOnce({ dryRun: false, batch: batch() })
    const { result } = setup()
    await act(() => result.current.prepare('PREDICTION'))
    await act(() => result.current.confirm())

    expect(writeBack.mock.calls[1]![1]).toMatchObject({
      kind: 'PREDICTION',
      dryRun: false,
    })
    expect(toast.success).toHaveBeenCalledWith(
      'Wrote 1 points to OUT.PRED',
      expect.anything(),
    )
    expect(toast.error).not.toHaveBeenCalled()
    expect(onWritten).toHaveBeenCalledTimes(1)
    expect(result.current.pending).toBeNull()
  })

  it.each([
    ['PARTIAL', /Partly written: 1 of 2 points verified/],
    ['FAILED', /Not written: 1 of 2 points verified/],
  ] as const)('a %s batch is NOT reported as success', async (status, text) => {
    writeBack.mockResolvedValueOnce(dry({ pointCount: 2 }))
    writeBack.mockResolvedValueOnce({
      dryRun: false,
      batch: batch({
        status,
        pointCount: 2,
        okCount: 1,
        failedCount: 1,
        error: 'PI rejected one value',
      }),
    })
    const { result } = setup()
    await act(() => result.current.prepare('PREDICTION'))
    await act(() => result.current.confirm())

    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(text), {
      description: 'PI rejected one value',
    })
    // The batch exists either way, so history must refresh.
    expect(onWritten).toHaveBeenCalledTimes(1)
  })

  it('a refused write (409 etc.) shows the server text and keeps the dialog open to retry or cancel', async () => {
    writeBack.mockResolvedValueOnce(dry())
    writeBack.mockRejectedValueOnce(
      new Error('Another write to OUT.PRED is in progress.'),
    )
    const { result } = setup()
    await act(() => result.current.prepare('PREDICTION'))
    await act(() => result.current.confirm())

    expect(toast.error).toHaveBeenCalledWith(
      'Another write to OUT.PRED is in progress.',
    )
    expect(onWritten).not.toHaveBeenCalled()
    expect(result.current.pending).not.toBeNull()
    expect(result.current.writing).toBe(false)
  })

  it('confirm with no pending dry run does nothing', async () => {
    const { result } = setup()
    await act(() => result.current.confirm())
    expect(writeBack).not.toHaveBeenCalled()
  })
})
