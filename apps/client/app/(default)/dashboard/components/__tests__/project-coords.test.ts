import { describe, it, expect } from 'vitest'
import {
  projectToIso,
  getZoneOffset,
  normalizeCoord,
} from '../../../../../store/project-coords'

describe('normalizeCoord', () => {
  it('returns 0 when x equals minX', () => {
    expect(normalizeCoord(10, 10, 100)).toBe(0)
  })
  it('returns 1 when x equals maxX', () => {
    expect(normalizeCoord(100, 10, 100)).toBe(1)
  })
  it('returns 0.5 for midpoint', () => {
    expect(normalizeCoord(55, 10, 100)).toBeCloseTo(0.5)
  })
  it('clamps to 0 when range is zero (single node edge case)', () => {
    expect(normalizeCoord(50, 50, 50)).toBe(0)
  })
})

describe('getZoneOffset', () => {
  it('index 0 → col 0, row 0 → offset (0, 0)', () => {
    expect(getZoneOffset(0)).toEqual({ x: 0, y: 0 })
  })
  it('index 1 → col 1, row 0 → offset (280, 0)', () => {
    expect(getZoneOffset(1)).toEqual({ x: 280, y: 0 })
  })
  it('index 2 → col 0, row 1 → offset (0, 160)', () => {
    expect(getZoneOffset(2)).toEqual({ x: 0, y: 160 })
  })
  it('index 3 → col 1, row 1 → offset (280, 160)', () => {
    expect(getZoneOffset(3)).toEqual({ x: 280, y: 160 })
  })
})

describe('projectToIso', () => {
  it('places single node at zone center when range is zero', () => {
    const result = projectToIso(50, 50, 50, 50, 50, 50, 0, 0, 300, 200)
    expect(result.x).toBeCloseTo(300)
    expect(result.y).toBeCloseTo(200)
  })
  it('returns numeric x and y', () => {
    const result = projectToIso(200, 100, 0, 400, 0, 300, 0, 0, 300, 200)
    expect(typeof result.x).toBe('number')
    expect(typeof result.y).toBe('number')
    expect(isFinite(result.x)).toBe(true)
    expect(isFinite(result.y)).toBe(true)
  })
  it('two nodes at opposite corners produce different iso positions', () => {
    const a = projectToIso(0, 0, 0, 400, 0, 300, 0, 0, 300, 200)
    const b = projectToIso(400, 300, 0, 400, 0, 300, 0, 0, 300, 200)
    expect(a.x).not.toBeCloseTo(b.x)
    expect(a.y).not.toBeCloseTo(b.y)
  })
})
