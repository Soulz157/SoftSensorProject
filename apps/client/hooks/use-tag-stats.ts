import { useMemo, useState } from 'react'
import { chartColorVar, resolveTagMeta } from '@/lib/mock-readings'
import { tagDistribution } from '@/lib/data-quality'
import type { Dataset } from '@/lib/preprocessing'

export const TAG_STATS_PAGE_SIZE = 10

export interface TagStatRow {
  tag: string
  mean: number
  median: number
  mode: number
  std: number
  fill: string
}

export type FlatRow = {
  timestamp: string
  [tag: string]: string | number | null
}

export interface UseTagStatsReturn {
  allStats: TagStatRow[]
  flatRows: FlatRow[]
  query: string
  setQuery: (q: string) => void
  page: number
  setPage: (p: number) => void
  pageStats: TagStatRow[]
  totalPages: number
  selectedTag: string
  setSelectedTag: (tag: string) => void
  selectedRow: TagStatRow | undefined
  setSelectedTags: (tags: string[]) => void
  selectedTags: string[]
  toggleTag: (tag: string) => void
}

export const MAX_COMPARISON_TAGS = 5

export function useTagStats(dataset: Dataset): UseTagStatsReturn {
  const allStats = useMemo<TagStatRow[]>(
    () =>
      dataset.tags.map(tag => {
        const d = tagDistribution(dataset, tag)
        return {
          tag,
          mean: d.mean,
          median: d.median,
          mode: d.mode,
          std: d.std,
          fill: chartColorVar(resolveTagMeta(tag).chartIndex),
        }
      }),
    [dataset],
  )

  const flatRows = useMemo<FlatRow[]>(
    () =>
      dataset.rows.map(row => {
        const flat: FlatRow = { timestamp: row.timestamp }
        for (const tag of dataset.tags) {
          flat[tag] = row.cells[tag]?.value ?? null
        }
        return flat
      }),
    [dataset],
  )

  const [rawQuery, setRawQuery] = useState('')
  const [rawPage, setRawPage] = useState(0)
  const [rawSelectedTag, setRawSelectedTag] = useState<string>(
    () => dataset.tags[0] ?? '',
  )
  const [rawSelectedTags, setRawSelectedTags] = useState<string[]>(() =>
    dataset.tags[0] ? [dataset.tags[0]] : [],
  )

  const filtered = useMemo(() => {
    const q = rawQuery.trim().toLowerCase()
    return q ? allStats.filter(r => r.tag.toLowerCase().includes(q)) : allStats
  }, [allStats, rawQuery])

  const totalPages = Math.max(
    1,
    Math.ceil(filtered.length / TAG_STATS_PAGE_SIZE),
  )

  const clampedPage = Math.min(rawPage, totalPages - 1)
  const pageStats = filtered.slice(
    clampedPage * TAG_STATS_PAGE_SIZE,
    (clampedPage + 1) * TAG_STATS_PAGE_SIZE,
  )

  // Validate selectedTag inline — fall back to first available
  const resolvedTag = allStats.some(d => d.tag === rawSelectedTag)
    ? rawSelectedTag
    : (allStats[0]?.tag ?? '')

  const selectedRow = allStats.find(d => d.tag === resolvedTag)

  // Validate selectedTags inline — drop tags no longer in the dataset, fall
  // back to the first available tag if that empties the selection.
  const validSelectedTags = rawSelectedTags.filter(t =>
    allStats.some(d => d.tag === t),
  )
  const resolvedTags =
    validSelectedTags.length > 0
      ? validSelectedTags
      : allStats[0]
        ? [allStats[0].tag]
        : []

  const setQuery = (q: string) => {
    setRawQuery(q)
    setRawPage(0)
  }

  const setPage = (p: number) => {
    setRawPage(Math.max(0, Math.min(p, totalPages - 1)))
  }

  const setSelectedTag = (tag: string) => {
    if (allStats.some(d => d.tag === tag)) setRawSelectedTag(tag)
  }

  const setSelectedTags = (tags: string[]) => {
    const validTags = tags.filter(t => allStats.some(d => d.tag === t))
    if (validTags.length > 0) {
      setRawSelectedTags(validTags)
    }
  }

  const toggleTag = (tag: string) => {
    setRawSelectedTags(prev => {
      const current = prev.filter(t => allStats.some(d => d.tag === t))
      if (current.includes(tag)) {
        return current.length > 1 ? current.filter(t => t !== tag) : current
      }
      return current.length < MAX_COMPARISON_TAGS ? [...current, tag] : current
    })
  }

  return {
    allStats,
    flatRows,
    query: rawQuery,
    setQuery,
    page: clampedPage,
    setPage,
    pageStats,
    totalPages,
    selectedTag: resolvedTag,
    setSelectedTag,
    selectedRow,
    selectedTags: resolvedTags,
    setSelectedTags,
    toggleTag,
  }
}
