'use client'

import { useCallback, useMemo } from 'react'
import { useAtom } from 'jotai'
import { badDataByTag, badDataDetailByTag } from '@/lib/data-quality'
import { chartColorVar, resolveTagMeta } from '@/lib/mock-readings'
import type { Dataset } from '@/lib/preprocessing'
import type { BadDataDetail } from '@/app/(default)/data-studio/create/components/bad-data-breakdown'
import { dwFocusedTagAtom, dwHiddenTagsAtom } from '@/store/dataset-studio'

export interface UseDatasetTagSelectionResult {
  /** Every tag in the dataset (full membership — never mutated here). */
  tags: string[]
  /** Tags currently plotted/analyzed: `tags` minus the hidden set. */
  activeTags: string[]
  /** Tags hidden from charts/analysis. */
  hidden: Set<string>
  /** The emphasized tag (falls back to the first active/available tag). */
  focusedTag: string[]
  /** Per-tag unified Bad Data (Bad + Questionable) row count. */
  badByTag: Record<string, number>
  /** Per-tag Bad/Questionable breakdown for the detail popover. */
  badDetailByTag: Record<string, BadDataDetail>
  /** Stable chart color for a tag. */
  colorForTag: (tag: string) => string
  /** Toggle a single tag's visibility. */
  toggleVisible: (tag: string) => void
  /** Focus a tag (also un-hides it so the focused series is always visible). */
  setFocused: (tag: string[]) => void
  /** Show every tag. */
  selectAll: () => void
  /** Hide every tag. */
  clearAll: () => void
  refresh: () => void
}

/**
 * Single source of truth for the analysis tag selection shared by the
 * persistent Tag Sidebar and the Step-3.1 Data Analysis card. Backed by
 * `dwHiddenTagsAtom` (visibility) + `dwFocusedTagAtom` (emphasis) — NOT the
 * dataset-membership atom, so toggling here never resets the fetch.
 */
export function useDatasetTagSelection(
  dataset: Dataset,
): UseDatasetTagSelectionResult {
  const tags = dataset.tags
  const [hiddenList, setHiddenList] = useAtom(dwHiddenTagsAtom)
  const [rawFocused, setRawFocused] = useAtom(dwFocusedTagAtom)

  const hidden = useMemo(
    () => new Set(hiddenList.filter(t => tags.includes(t))),
    [hiddenList, tags],
  )

  const activeTags = useMemo(
    () => tags.filter(t => !hidden.has(t)),
    [tags, hidden],
  )

  const focusedTag = tags.includes(rawFocused)
    ? [rawFocused]
    : activeTags[0]
      ? [activeTags[0]]
      : tags[0]
        ? [tags[0]]
        : []

  const badByTag = useMemo(() => badDataByTag(dataset), [dataset])
  const badDetailByTag = useMemo(() => badDataDetailByTag(dataset), [dataset])

  const colorForTag = useCallback(
    (tag: string) => chartColorVar(resolveTagMeta(tag).chartIndex),
    [],
  )

  const toggleVisible = useCallback(
    (tag: string) => {
      setHiddenList(prev =>
        prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag],
      )
    },
    [setHiddenList],
  )

  const setFocused = useCallback(
    (tags: string[]) => {
      setRawFocused(tags[0] ?? '')
      // Keep the focused series visible.
      setHiddenList(prev => prev.filter(t => t !== tags[0]))
    },
    [setRawFocused, setHiddenList],
  )

  const selectAll = useCallback(() => setHiddenList([]), [setHiddenList])

  const clearAll = useCallback(
    () => setHiddenList([...tags]),
    [setHiddenList, tags],
  )

  const refresh = useCallback(() => {
    setHiddenList(prev => prev.filter(t => tags.includes(t)))
    setRawFocused(prev => (tags.includes(prev) ? prev : ''))
  }, [setHiddenList, setRawFocused, tags])

  return {
    refresh,
    tags,
    activeTags,
    hidden,
    focusedTag,
    badByTag,
    badDetailByTag,
    colorForTag,
    toggleVisible,
    setFocused,
    selectAll,
    clearAll,
  }
}
