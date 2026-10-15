import { describe, expect, it } from 'vitest'
import {
  CORNER,
  GRID,
  makeProjection,
  plateOutline,
  roundedPath,
  towerHeightScale,
} from '@/lib/iso-tower'
import { countBinary, equipmentAlertChip } from '@/lib/overview-status'
import type { CanvasNode } from '@/services/canvas'

describe('makeProjection', () => {
  it('puts the ground origin at (cx, cy) and lifts z straight up', () => {
    const { X, Y, P } = makeProjection(100, 50, 0.5)
    expect(X(0, 0)).toBe(100)
    expect(Y(0, 0)).toBe(50)
    expect(Y(0, 0, 12)).toBe(38)
    expect(P(1, 0)).toBe('106,53')
  })

  it('squash scales only the vertical axis', () => {
    const a = makeProjection(0, 0, 0.5)
    const b = makeProjection(0, 0, 0.25)
    expect(a.X(2, 1)).toBe(b.X(2, 1))
    expect(a.Y(2, 1)).toBe(2 * b.Y(2, 1))
  })
})

describe('roundedPath', () => {
  it('is empty below two points', () => {
    expect(roundedPath([[1, 2]], 4)).toBe('')
  })

  it('starts and ends on the given endpoints, rounding the corner', () => {
    const d = roundedPath(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      4,
    )
    expect(d.startsWith('M 0 0')).toBe(true)
    expect(d.endsWith('L 10 10')).toBe(true)
    expect(d).toContain('Q 10 0')
  })
})

describe('plateOutline', () => {
  it('cuts each of the four corners into three points, inside the GRID square', () => {
    const pts = plateOutline()
    expect(pts).toHaveLength(12)
    for (const [x, y] of pts) {
      expect(Math.abs(x)).toBeLessThanOrEqual(GRID)
      expect(Math.abs(y)).toBeLessThanOrEqual(GRID)
    }
    expect(pts[0]).toEqual([-GRID, -GRID + CORNER])
  })
})

describe('towerHeightScale', () => {
  it('clamps to [0.82, 1.3]', () => {
    expect(towerHeightScale(0)).toBe(0.82)
    expect(towerHeightScale(10)).toBeCloseTo(1.04)
    expect(towerHeightScale(100)).toBe(1.3)
  })
})

function node(id: string, status: string): CanvasNode {
  return { id, data: { status } } as unknown as CanvasNode
}

describe('equipmentAlertChip (MODEL-SERVE-033)', () => {
  it('is null when nothing is abnormal (warning and offline read Normal)', () => {
    const list = [
      node('a', 'normal'),
      node('b', 'warning'),
      node('c', 'offline'),
    ]
    expect(equipmentAlertChip(countBinary(list))).toBeNull()
  })

  it('counts alarms and equipment with an abnormal model', () => {
    const list = [
      node('a', 'alarm'),
      node('b', 'normal'),
      node('c', 'normal'),
      node('d', 'warning'),
    ]
    expect(equipmentAlertChip(countBinary(list, new Set(['c'])))).toEqual({
      abnormal: 2,
      total: 4,
    })
  })

  it('is null for an empty plant', () => {
    expect(equipmentAlertChip(countBinary([]))).toBeNull()
  })
})
