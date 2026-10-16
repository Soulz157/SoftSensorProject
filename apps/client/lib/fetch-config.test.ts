import { describe, it, expect } from 'vitest'
import {
  BATCH_SIZE_MAX,
  BATCH_SIZE_MIN,
  DEFAULT_FETCH_CONFIG,
  clampBatchSize,
  parseBatchSizeInput,
  toggleSummaryType,
} from './fetch-config'

describe('toggleSummaryType', () => {
  it('adds an aggregate that is not selected', () => {
    expect(toggleSummaryType(['Average'], 'Maximum')).toEqual([
      'Average',
      'Maximum',
    ])
  })

  it('removes an aggregate that is already selected', () => {
    expect(toggleSummaryType(['Average', 'Maximum'], 'Average')).toEqual([
      'Maximum',
    ])
  })

  it('never empties the selection — removing the last item is a no-op', () => {
    expect(toggleSummaryType(['Average'], 'Average')).toEqual(['Average'])
  })
})

describe('clampBatchSize', () => {
  it('clamps below the minimum up to BATCH_SIZE_MIN', () => {
    expect(clampBatchSize(0)).toBe(BATCH_SIZE_MIN)
    expect(clampBatchSize(-5)).toBe(BATCH_SIZE_MIN)
  })

  it('clamps above the maximum down to BATCH_SIZE_MAX', () => {
    expect(clampBatchSize(9999)).toBe(BATCH_SIZE_MAX)
  })

  it('truncates fractional input', () => {
    expect(clampBatchSize(300.7)).toBe(300)
  })

  it('falls back to the default on non-finite input', () => {
    expect(clampBatchSize(Number.NaN)).toBe(DEFAULT_FETCH_CONFIG.batchSize)
  })

  it('passes an in-range value through', () => {
    expect(clampBatchSize(150)).toBe(150)
  })
})

describe('parseBatchSizeInput', () => {
  it('reads a whole number in range, ignoring surrounding spaces', () => {
    expect(parseBatchSizeInput('50')).toBe(50)
    expect(parseBatchSizeInput(' 250 ')).toBe(250)
    expect(parseBatchSizeInput(String(BATCH_SIZE_MIN))).toBe(BATCH_SIZE_MIN)
    expect(parseBatchSizeInput(String(BATCH_SIZE_MAX))).toBe(BATCH_SIZE_MAX)
  })

  it.each([
    '',
    '  ',
    '0',
    '-5',
    '1.5',
    '1e3',
    'abc',
    String(BATCH_SIZE_MAX + 1),
  ])('rejects %j without rewriting it', raw => {
    expect(parseBatchSizeInput(raw)).toBeNull()
  })
})
