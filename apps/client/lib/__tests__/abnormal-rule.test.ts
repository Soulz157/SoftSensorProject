import { describe, expect, it } from 'vitest'
import {
  countBinary,
  deriveBinaryStatus,
  isAbnormal,
  isEquipmentAbnormal,
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
  it('is Abnormal for an alert (stored as alarm) and a warning', () => {
    expect(toBinaryStatus('alarm')).toBe('abnormal')
    expect(toBinaryStatus('warning')).toBe('abnormal')
    expect(toBinaryStatus('offline')).toBe('normal')
    expect(toBinaryStatus('normal')).toBe('normal')
    expect(isAbnormal(undefined)).toBe(false)
  })
})

describe('isModelAbnormal', () => {
  it('is true for a failed deploy or a monitoring ALERT, WARN or FROZEN', () => {
    expect(isModelAbnormal(model({ deployStatus: 'error' }))).toBe(true)
    expect(
      isModelAbnormal(
        model({
          deployStatus: 'running',
          monitoring: { status: 'ALERT', reason: 'STALE', frozenColumns: [] },
        }),
      ),
    ).toBe(true)
    for (const status of ['WARN', 'FROZEN'] as const) {
      expect(
        isModelAbnormal(
          model({
            deployStatus: 'running',
            monitoring: { status, reason: null, frozenColumns: [] },
          }),
        ),
      ).toBe(true)
    }
    for (const status of ['OK', 'OFF'] as const) {
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

  it('counts alerting and warning equipment without model faults', () => {
    expect(countBinary(nodes)).toEqual({ normal: 1, abnormal: 2 })
  })

  it('folds a node whose model is abnormal into Abnormal', () => {
    const withModel = new Set(['a'])
    expect(isEquipmentAbnormal(nodes[0]!, withModel)).toBe(true)
    expect(countBinary(nodes, withModel)).toEqual({ normal: 0, abnormal: 3 })
  })

  it('reads an offline-only plant as Normal unless a model is abnormal, and a warning plant as Abnormal', () => {
    const calm = [node('a', 'offline'), node('b', 'normal')]
    expect(deriveBinaryStatus(calm)).toBe('normal')
    expect(deriveBinaryStatus(calm, new Set(['b']))).toBe('abnormal')
    expect(deriveBinaryStatus([node('a', 'warning')])).toBe('abnormal')
  })
})
