import { describe, expect, it } from 'vitest'
import {
  countBinary,
  deriveBinaryStatus,
  isAbnormal,
  isNodeAbnormal,
  toBinaryStatus,
} from '@/lib/overview-status'
import { isModelAbnormal } from '@/lib/model-status'
import type { CanvasNode } from '@/services/canvas'
import type { AIModel } from '@/types'

/** MODEL-SERVE-024-D02 — THE one Normal/Abnormal rule. */

const node = (id: string, status: string) =>
  ({ id, data: { status } }) as unknown as CanvasNode

const model = (data: Partial<NonNullable<AIModel['data']>>) =>
  ({ data }) as unknown as AIModel

describe('toBinaryStatus / isAbnormal', () => {
  it('is Abnormal only for an alert (stored as alarm)', () => {
    expect(toBinaryStatus('alarm')).toBe('abnormal')
    expect(toBinaryStatus('warning')).toBe('normal')
    expect(toBinaryStatus('offline')).toBe('normal')
    expect(toBinaryStatus('normal')).toBe('normal')
    expect(isAbnormal(undefined)).toBe(false)
  })
})

describe('isModelAbnormal', () => {
  it('is true for a failed deploy or a monitoring ALERT only', () => {
    expect(isModelAbnormal(model({ deployStatus: 'error' }))).toBe(true)
    expect(
      isModelAbnormal(
        model({
          deployStatus: 'running',
          monitoring: { status: 'ALERT', reason: 'STALE', frozenColumns: [] },
        }),
      ),
    ).toBe(true)
    for (const status of ['WARN', 'FROZEN', 'OK', 'OFF'] as const) {
      expect(
        isModelAbnormal(
          model({
            deployStatus: 'running',
            monitoring: { status, reason: null, frozenColumns: [] },
          }),
        ),
      ).toBe(false)
    }
  })
})

describe('plant roll-up with model faults', () => {
  const nodes = [node('a', 'normal'), node('b', 'warning'), node('c', 'alarm')]

  it('counts only alerting equipment without model faults', () => {
    expect(countBinary(nodes)).toEqual({ normal: 2, abnormal: 1 })
  })

  it('folds a node whose model is abnormal into Abnormal', () => {
    const withModel = new Set(['a'])
    expect(isNodeAbnormal(nodes[0]!, withModel)).toBe(true)
    expect(countBinary(nodes, withModel)).toEqual({ normal: 1, abnormal: 2 })
  })

  it('reads a warning/offline-only plant as Normal unless a model is abnormal', () => {
    const calm = [node('a', 'warning'), node('b', 'offline')]
    expect(deriveBinaryStatus(calm)).toBe('normal')
    expect(deriveBinaryStatus(calm, new Set(['b']))).toBe('abnormal')
  })
})
