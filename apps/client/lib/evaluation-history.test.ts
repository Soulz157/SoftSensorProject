import { describe, expect, it } from 'vitest'
import type { RollbackDryRun } from '@/services/model-evaluation'
import {
  canRollbackNow,
  formatDriftActual,
  formatPlantTime,
  formatStored,
  rollbackBlocker,
} from './evaluation-history'

const batch = {
  kind: 'PREDICTION' as const,
  status: 'SUCCEEDED' as const,
  okCount: 3,
  failedCount: 0,
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

describe('rollbackBlocker', () => {
  it('is null for a finished batch the caller may undo', () => {
    expect(rollbackBlocker(batch, true)).toBeNull()
    expect(rollbackBlocker({ ...batch, status: 'PARTIAL' }, true)).toBeNull()
    expect(rollbackBlocker({ ...batch, status: 'FAILED' }, true)).toBeNull()
  })

  it('names the role when the caller cannot write', () => {
    expect(rollbackBlocker(batch, false)).toMatch(/owner or an admin/)
  })

  it('refuses a rollback batch, an undone batch and an open batch', () => {
    expect(rollbackBlocker({ ...batch, kind: 'ROLLBACK' }, true)).toMatch(
      /cannot be rolled back/,
    )
    expect(rollbackBlocker({ ...batch, status: 'ROLLED_BACK' }, true)).toMatch(
      /Already rolled back/,
    )
    expect(rollbackBlocker({ ...batch, status: 'WRITING' }, true)).toMatch(
      /Still being written/,
    )
  })

  it('refuses a batch that was refused before it snapshotted anything', () => {
    expect(
      rollbackBlocker({ ...batch, status: 'FAILED', okCount: 0 }, true),
    ).toMatch(/Nothing to roll back/)
  })
})

describe('canRollbackNow', () => {
  it('goes ahead with no drift and no blocker', () => {
    expect(canRollbackNow(plan(), false)).toBe(true)
  })

  it('drift needs the tick', () => {
    const drifted = plan({ driftCount: 2, canForce: true, canProceed: false })
    expect(canRollbackNow(drifted, false)).toBe(false)
    expect(canRollbackNow(drifted, true)).toBe(true)
  })

  it('a later overlapping write is never overridden, ticked or not', () => {
    const blocked = plan({
      driftCount: 1,
      canForce: false,
      blockedBy: {
        id: 'b2',
        kind: 'LAB',
        status: 'SUCCEEDED',
        createdAt: '2026-10-14T03:00:00.000Z',
        rangeFrom: '2026-10-14T00:00:00.000Z',
        rangeTo: '2026-10-14T01:00:00.000Z',
      },
    })
    expect(canRollbackNow(blocked, true)).toBe(false)
  })
})

describe('formatters', () => {
  it('shows an absent value as none, never 0', () => {
    expect(formatStored(null)).toBe('none')
    expect(formatStored(0)).toBe('0')
    expect(formatStored(5, false)).toBe('none')
  })

  it('reads a drifted non-number as a system state', () => {
    expect(formatDriftActual(4.5)).toBe('4.5')
    expect(formatDriftActual('none')).toBe('none')
    expect(formatDriftActual('digital')).toBe('a system state')
  })

  it('prints a UTC instant as plant time (UTC+7)', () => {
    expect(formatPlantTime('2026-10-14T00:00:00.000Z')).toBe(
      'Oct 14, 2026 07:00',
    )
  })
})
