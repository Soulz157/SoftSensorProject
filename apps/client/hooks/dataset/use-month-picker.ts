'use client'

import { useMemo, useState } from 'react'
import type { MonthOption } from '@/lib/time-window'
import { allMonths, defaultMonthKeys, MAX_MONTHS } from '@/lib/monthly-compare'

/**
 * Which months a monthly comparison covers. Shared by `DataAnalysisCard` and
 * the Compare-validation modal so both pick, cap and reset months by one rule.
 *
 * `null` pick = never touched: the latest two months. Picks are kept in
 * calendar order so the chart, caption and popover list all read oldest →
 * newest. "All months" is a scope, not a pick: it overrides the checklist
 * without erasing it, so turning it off returns to the months picked before.
 */
export function useMonthPicker(availableMonths: MonthOption[]) {
  const [monthKeysPick, setMonthKeysPick] = useState<string[] | null>(null)
  const [compareAllMonths, setCompareAllMonths] = useState(false)

  const pickedMonths = useMemo(() => {
    if (compareAllMonths) return allMonths(availableMonths)
    const keys = new Set(monthKeysPick ?? defaultMonthKeys(availableMonths))
    return availableMonths.filter(m => keys.has(m.key))
  }, [compareAllMonths, monthKeysPick, availableMonths])

  const pickedMonthKeys = useMemo(
    () => pickedMonths.map(m => m.key),
    [pickedMonths],
  )

  const toggleMonth = (key: string) => {
    if (pickedMonthKeys.includes(key)) {
      // Never down to zero: an empty pick would land on the charts' 'no-tags'
      // copy, which talks about tags, not months.
      if (pickedMonthKeys.length <= 1) return
      setMonthKeysPick(pickedMonthKeys.filter(k => k !== key))
    } else if (pickedMonthKeys.length < MAX_MONTHS) {
      setMonthKeysPick([...pickedMonthKeys, key])
    }
  }

  /** Back to the untouched default (latest two months, "All" off). */
  const resetMonths = () => {
    setMonthKeysPick(null)
    setCompareAllMonths(false)
  }

  return {
    pickedMonths,
    pickedMonthKeys,
    toggleMonth,
    compareAllMonths,
    setCompareAllMonths,
    resetMonths,
  }
}
