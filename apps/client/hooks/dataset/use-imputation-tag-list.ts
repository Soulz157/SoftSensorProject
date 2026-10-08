import { useCallback, useMemo, useState } from 'react'
import {
  qualityByTag,
  tagSeverity,
  type TagQuality,
  type TagSeverity,
} from '@/lib/data-quality'
import type {
  Dataset,
  // FillStrategyConfig,
  TagPipeline,
} from '@/lib/preprocessing'

/** One row in the Step 5.2 imputation master list — a tag plus its quality. */
export interface ImputationTagRow {
  tag: string
  quality: TagQuality
  severity: TagSeverity
  /** True once the user has picked a fill strategy for this tag. */
  completed: boolean
}

/**
 * Derives the per-tag imputation rows from the pre-cleansed `base` dataset and
 * the in-progress `draft` fill strategies, plus master-list selection/search
 * state. Pure derivation — no atom writes; the caller owns `draft`.
 */
export function useImputationTagList(
  base: Dataset,

  draft: Record<string, TagPipeline>,
) {
  const quality = useMemo(() => qualityByTag(base), [base])

  const rows = useMemo<ImputationTagRow[]>(
    () =>
      base.tags.map(tag => {
        const q = quality[tag] ?? {
          total: 0,
          good: 0,
          missing: 0,
          suspect: 0,
          frozen: 0,
          missingPct: 0,
          suspectPct: 0,
        }
        return {
          tag,
          quality: q,
          severity: tagSeverity(q),
          completed: (draft[tag]?.length ?? 0) > 0,
        }
      }),
    [base.tags, quality, draft],
  )

  const [query, setQuery] = useState('')
  const [selectedTag, setSelectedTag] = useState<string | null>(null)

  const filteredRows = useMemo(() => {
    if (!query) return rows
    const q = query.toLowerCase()
    return rows.filter(r => r.tag.toLowerCase().includes(q))
  }, [rows, query])

  const isLastTag = useMemo(() => {
    if (!selectedTag) return false
    const index = filteredRows.findIndex(r => r.tag === selectedTag)
    return index === filteredRows.length - 1
  }, [filteredRows, selectedTag])

  const selectNext = useCallback(() => {
    if (!selectedTag) return
    const index = filteredRows.findIndex(r => r.tag === selectedTag)
    if (index === -1 || index === filteredRows.length - 1) return
    const nextRow = filteredRows[index + 1]
    if (nextRow) setSelectedTag(nextRow.tag)
  }, [filteredRows, selectedTag])

  return {
    rows,
    filteredRows,
    query,
    setQuery,
    selectedTag,
    setSelectedTag,
    isLastTag,
    selectNext,
  }
}
