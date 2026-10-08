import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useMonthPicker } from '../use-month-picker'
import { MAX_MONTHS } from '@/lib/monthly-compare'
import { monthOptions } from '@/lib/time-window'

// Eight months, oldest first: Jan–Aug 2026.
const MONTHS = monthOptions('2026-01-01 00:00:00', '2026-08-31 23:00:00')

describe('useMonthPicker', () => {
  it('starts on the latest two months, in calendar order', () => {
    const { result } = renderHook(() => useMonthPicker(MONTHS))

    expect(result.current.pickedMonthKeys).toEqual(['2026-07', '2026-08'])
  })

  it('adds a month and keeps the picks in calendar order', () => {
    const { result } = renderHook(() => useMonthPicker(MONTHS))

    act(() => result.current.toggleMonth('2026-02'))

    expect(result.current.pickedMonthKeys).toEqual([
      '2026-02',
      '2026-07',
      '2026-08',
    ])
  })

  it('never drops below one month', () => {
    const { result } = renderHook(() => useMonthPicker(MONTHS))

    act(() => result.current.toggleMonth('2026-07'))
    expect(result.current.pickedMonthKeys).toEqual(['2026-08'])

    act(() => result.current.toggleMonth('2026-08'))
    expect(result.current.pickedMonthKeys).toEqual(['2026-08'])
  })

  it('caps the pick at MAX_MONTHS', () => {
    const { result } = renderHook(() => useMonthPicker(MONTHS))

    for (const key of ['2026-01', '2026-02', '2026-03', '2026-04']) {
      act(() => result.current.toggleMonth(key))
    }

    expect(result.current.pickedMonthKeys).toHaveLength(MAX_MONTHS)
  })

  it('"All months" overrides the checklist without erasing it', () => {
    const { result } = renderHook(() => useMonthPicker(MONTHS))
    act(() => result.current.toggleMonth('2026-03'))

    act(() => result.current.setCompareAllMonths(true))
    expect(result.current.pickedMonths).toHaveLength(MONTHS.length)

    act(() => result.current.setCompareAllMonths(false))
    expect(result.current.pickedMonthKeys).toEqual([
      '2026-03',
      '2026-07',
      '2026-08',
    ])
  })

  it('resetMonths returns to the untouched default', () => {
    const { result } = renderHook(() => useMonthPicker(MONTHS))
    act(() => result.current.toggleMonth('2026-03'))
    act(() => result.current.setCompareAllMonths(true))

    act(() => result.current.resetMonths())

    expect(result.current.compareAllMonths).toBe(false)
    expect(result.current.pickedMonthKeys).toEqual(['2026-07', '2026-08'])
  })
})
