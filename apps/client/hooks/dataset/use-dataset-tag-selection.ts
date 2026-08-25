'use client'

import { useCallback, useMemo, useState } from 'react'
import { useAtom } from 'jotai'
import { badDataByTag, badDataDetailByTag } from '@/lib/data-quality'
import { chartColorVar, resolveTagMeta } from '@/lib/mock-readings'
import type { Dataset } from '@/lib/preprocessing'
import type { BadDataDetail } from '@/app/(default)/data-studio/create/components/bad-data-breakdown'
import { dwFocusedTagAtom, dwHiddenTagsAtom } from '@/store/dataset-studio'

export interface UseDatasetTagSelectionOptions {
  /**
   * Keep the selection in component state instead of the `dw*` atoms.
   *
   * The atoms are wizard-scoped view state that nothing resets on leaving Data
   * Studio, so a caller OUTSIDE that wizard inherits whatever the tag sidebar
   * last hid. When that leftover covers every tag the caller has, `activeTags`
   * is empty and `RawTrendChart` early-returns its "Select one or more PI tags
   * to plot" placeholder — with no sidebar present to un-hide anything. That
   * is the model wizard's Dataset Review step, live.
   *
   * Isolated callers get the same API over local state: nothing leaks in, and
   * nothing they do leaks back out into a Data Studio draft.
   */
  isolated?: boolean
}

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
 *
 * Callers outside the Data Studio wizard must pass `{ isolated: true }` — see
 * `UseDatasetTagSelectionOptions.isolated` for what sharing those atoms costs.
 */
export function useDatasetTagSelection(
  dataset: Dataset,
  options: UseDatasetTagSelectionOptions = {},
): UseDatasetTagSelectionResult {
  const isolated = options.isolated ?? false
  const tags = dataset.tags

  // Both stores are subscribed unconditionally — hook order must not vary with
  // the mode — and only one of the two pairs is ever handed back.
  const [atomHidden, setAtomHidden] = useAtom(dwHiddenTagsAtom)
  const [atomFocused, setAtomFocused] = useAtom(dwFocusedTagAtom)
  const [localHidden, setLocalHidden] = useState<string[]>([])
  const [localFocused, setLocalFocused] = useState<string>('')

  const hiddenList = isolated ? localHidden : atomHidden
  const setHiddenList = isolated ? setLocalHidden : setAtomHidden
  const rawFocused = isolated ? localFocused : atomFocused
  const setRawFocused = isolated ? setLocalFocused : setAtomFocused

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
