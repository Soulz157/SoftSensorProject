'use client'

import { useMemo } from 'react'
import {
  useDatasetTagMetadata,
  deriveTagQuality,
  tagKey,
  type TagMeta,
} from './use-dataset-tag-metadata'
import { useTagResolution } from './use-tag-resolution'
import { parseTagSearch, type TagSearch } from '@/lib/tag-search'
import { PATTERN_CAP, useMultiPatternSearch } from './use-multi-pattern-search'

/** Server caps tag_names; ตัดที่ฝั่ง client แล้วบอกผู้ใช้ว่าตัดไปเท่าไหร่ */
export const MAX_NAMES = 500

export interface UseDatasetTagSearchResult {
  mode: TagSearch['mode']
  metaByTag: Map<string, TagMeta>
  tagsBySource: Map<string, string[]>
  /** โหมด names: ชื่อที่ PI ยืนยันว่าไม่มี */
  notFound: string[]
  /** โหมด names: จำนวนชื่อที่เกิน cap แล้วถูกตัด */
  droppedNames: number
  truncatedPatterns: string[]
  /** patterns mode: matched nothing */
  emptyPatterns: string[]
  droppedPatterns: string[]
  hasNextBySource: Map<string, boolean>
  pageBySource: Map<string, number>
  goto: (id: string, page: number) => void
  refetch: () => void
  loading: boolean
  error: string | null
}

/**
 * ช่อง search เดียว 2 โหมด
 *
 * - wildcard: `/pi/tags` แบบ paginated (browse catalog)
 * - names: `/pi/tags/resolve` ทีเดียว ไม่มีหน้า — เป็นทางเดียวที่ค้น tag
 *   หลายตัวซึ่งกระจายอยู่คนละหน้า catalog ได้ในคำสั่งเดียว
 *
 * คืน shape เดียวกันทั้งสองโหมด ตารางเลยไม่ต้องรู้ว่าโหมดไหน ยกเว้น
 * pagination bar กับ empty state ที่ต่างกันจริง
 */
export function useDatasetTagSearch(
  input: string,
  pageSize = 100,
): UseDatasetTagSearchResult {
  const search = useMemo(() => parseTagSearch(input), [input])
  const isNames = search.mode === 'names'

  const names = useMemo(
    () => (search.mode === 'names' ? search.names.slice(0, MAX_NAMES) : []),
    [search],
  )
  const droppedNames =
    search.mode === 'names' ? search.names.length - names.length : 0

  const patternList = useMemo(
    () => (search.mode === 'patterns' ? search.patterns : []),
    [search],
  )

  const catalog = useDatasetTagMetadata(
    search.mode === 'wildcard' ? search.pattern : '*',
    pageSize,
    search.mode === 'wildcard',
  )
  const resolution = useTagResolution(names)
  const patterns = useMultiPatternSearch(patternList, PATTERN_CAP)

  const resolvedView = useMemo(() => {
    const meta = new Map<string, TagMeta>()
    const bySource = new Map<string, string[]>()
    if (!isNames) return { meta, bySource }

    for (const [queried, res] of resolution.resolved) {
      // ใช้ชื่อจริงจาก PI เป็น key: selection กับ metaByTag ต้องใช้ชื่อชุด
      // เดียวกัน ไม่งั้น tag ที่ผู้ใช้พิมพ์คนละตัวพิมพ์จะกลายเป็นสองตัว
      const name = res.actualName ?? queried
      const base = {
        tagName: name,
        description: res.description,
        value: res.value,
        unit: res.unit,
        pointType: res.pointType,
        isGood: res.isGood,
        questionable: res.questionable,
        substituted: res.substituted,
        timestamp: res.timestamp,
      }
      meta.set(tagKey(res.sourceId, name), {
        ...base,
        quality: deriveTagQuality(base),
      })
      const list = bySource.get(res.sourceId) ?? []
      list.push(name)
      bySource.set(res.sourceId, list)
    }
    return { meta, bySource }
  }, [isNames, resolution.resolved])

  const empty = useMemo(() => new Map<string, never>(), [])

  if (search.mode === 'patterns') {
    return {
      mode: 'patterns',
      metaByTag: patterns.metaByTag,
      tagsBySource: patterns.tagsBySource,
      notFound: [],
      droppedNames: 0,
      truncatedPatterns: patterns.truncatedPatterns,
      emptyPatterns: patterns.emptyPatterns,
      droppedPatterns: patterns.droppedPatterns,
      // Merged multi-pattern results have no single cursor to advance.
      hasNextBySource: empty as Map<string, boolean>,
      pageBySource: empty as Map<string, number>,
      goto: catalog.goto,
      refetch: patterns.refetch,
      loading: patterns.loading,
      error: patterns.error,
    }
  }

  if (search.mode === 'names') {
    return {
      mode: 'names',
      metaByTag: resolvedView.meta,
      tagsBySource: resolvedView.bySource,
      notFound: resolution.notFound,
      droppedNames,
      truncatedPatterns: [],
      emptyPatterns: [],
      droppedPatterns: [],
      hasNextBySource: empty as Map<string, boolean>,
      pageBySource: empty as Map<string, number>,
      goto: catalog.goto,
      refetch: resolution.refetch,
      loading: resolution.loading,
      error: resolution.error,
    }
  }

  return {
    mode: 'wildcard',
    metaByTag: catalog.metaByTag,
    tagsBySource: catalog.tagsBySource,
    notFound: [],
    droppedNames: 0,
    truncatedPatterns: [],
    emptyPatterns: [],
    droppedPatterns: [],
    hasNextBySource: catalog.hasNextBySource,
    pageBySource: catalog.pageBySource,
    goto: catalog.goto,
    refetch: catalog.refetch,
    loading: catalog.loading,
    error: catalog.error,
  }
}
