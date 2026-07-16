'use client'

import { useCallback, useEffect, useState } from 'react'

export const MAX_COMPARE = 5

export interface UseCompareTagsResult {
  /** Tags overlaid on Histogram / Box Plot + shown in the stat table (⊆ activeTags, ≤5). */
  compareTags: string[]
  /** Add (if room) or remove a tag from the comparison set. */
  toggle: (tag: string) => void
  /** True when the comparison set is full (MAX_COMPARE reached). */
  atCap: boolean
}

/**
 * Capped "tags being compared" selection for the Data Analysis card — separate
 * from the sidebar's active/visible set. Always a subset of `activeTags`, max
 * MAX_COMPARE. Seeds with the first few active tags and prunes as `activeTags`
 * changes so the comparison never references a dropped tag.
 */
export function useCompareTags(activeTags: string[]): UseCompareTagsResult {
  const [compareTags, setCompareTags] = useState<string[]>([])

  // Keep the set valid against the current active tags: drop stale entries, and
  // seed the first min(5, n) active tags when the set would otherwise be empty.
  useEffect(() => {
    setCompareTags(prev => {
      const kept = prev.filter(t => activeTags.includes(t))
      if (kept.length > 0) {
        return kept.length === prev.length ? prev : kept
      }
      return activeTags.slice(0, MAX_COMPARE)
    })
  }, [activeTags])

  const toggle = useCallback((tag: string) => {
    setCompareTags(prev => {
      if (prev.includes(tag)) return prev.filter(t => t !== tag)
      if (prev.length >= MAX_COMPARE) return prev
      return [...prev, tag]
    })
  }, [])

  return {
    compareTags,
    toggle,
    atCap: compareTags.length >= MAX_COMPARE,
  }
}
