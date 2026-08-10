'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAtomValue } from 'jotai'
import { dwSelectedSourcesAtom } from '@/store/dataset-studio'
import { dataSourceService, type TagMetaItem } from '@/services/data-sources'

export type TagQuality = 'good' | 'questionable' | 'bad' | 'unknown'

export const tagKey = (sourceId: string, tagName: string) =>
  `${sourceId}::${tagName}`

export const sourceIdOf = (key: string) => key.slice(0, key.indexOf('::'))
export const tagNameOf = (key: string) => key.slice(key.indexOf('::') + 2)

interface PageResult {
  tags: TagMetaItem[]
  hasNext: boolean
}
/**
 * Derive a traffic-light quality from PI snapshot flags. `Is Good = false` is a
 * Bad reading; otherwise a Questionable flag downgrades to amber; a clean Good
 * flag is green. Missing flags (metadata not yet loaded) read as unknown.
 */
export function deriveTagQuality(m: {
  isGood?: boolean | null
  questionable?: boolean | null
}): TagQuality {
  if (m.isGood === false) return 'bad'
  if (m.questionable === true) return 'questionable'
  if (m.isGood === true) return 'good'
  return 'unknown'
}

export interface TagMeta {
  tagName: string
  description: string | null
  value: number | string | null
  unit: string | null
  pointType: string | null
  isGood: boolean | null
  questionable: boolean | null
  substituted: boolean | null
  timestamp: string | null
  quality: TagQuality
}

function toMeta(item: TagMetaItem): TagMeta {
  return {
    tagName: item.tag_name,
    description: item.description,
    value: item.value,
    unit: item.unit,
    pointType: item.point_type,
    isGood: item.isGood,
    questionable: item.questionable,
    substituted: item.substituted,
    timestamp: item.timestamp,
    quality: deriveTagQuality(item),
  }
}

interface Result {
  metaByTag: Map<string, TagMeta>
  tagsBySource: Map<string, string[]>

  hasNextBySource: Map<string, boolean>
  pageBySource: Map<string, number>
  goto: (id: string, page: number) => void
  loading: boolean
  refetch: () => void
  error: string | null
}

/**
 * Fetch enriched tag metadata (value / unit / point-type / quality) for the
 * selected PI sources and key it by tag name — metadata only, NO archive read.
 * Non-blocking: the table renders immediately and fills these columns in when
 * the map resolves. Bounded by `maxCount` (server-side pagination is a
 * follow-up for very large PI systems).
 */
export function useDatasetTagMetadata(
  nameFilter = '*',
  pageSize = 100,
  enabled = true,
): Result {
  const sources = useAtomValue(dwSelectedSourcesAtom)
  const [pages, setPages] = useState<Map<string, PageResult>>(new Map())

  const [pageBySource, setPageBySource] = useState<Map<string, number>>(
    new Map(),
  )

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)

  const cache = useRef(new Map<string, PageResult>())

  const ids = useMemo(
    () => sources.filter(s => s.type === 'aveva').map(s => s.id),
    [sources],
  )

  const idsKey = JSON.stringify(ids)
  useEffect(() => {
    cache.current.clear()
    setPageBySource(new Map())
  }, [nameFilter, pageSize])

  useEffect(() => {
    setPageBySource(prev => {
      const next = new Map<string, number>()
      for (const id of ids) {
        const p = prev.get(id)
        if (p !== undefined) next.set(id, p)
      }
      return next.size === prev.size ? prev : next
    })
  }, [idsKey])

  const wantKey = ids
    .map(id => `${id}::${nameFilter}::${pageBySource.get(id) ?? 1}`)
    .join('|')

  useEffect(() => {
    if (!enabled || ids.length === 0) {
      setPages(new Map())
      setError(null)
      setLoading(false)
      return
    }
    if (ids.length === 0) {
      setPages(new Map())
      setError(null)
      setLoading(false)
      return
    }

    const wanted = ids.map(id => ({
      id,
      page: pageBySource.get(id) ?? 1,
      key: `${id}::${nameFilter}::${pageBySource.get(id) ?? 1}`,
    }))

    const missing = wanted.filter(w => !cache.current.has(w.key))
    if (missing.length === 0) {
      setPages(new Map(wanted.map(w => [w.id, cache.current.get(w.key)!])))
      setError(null)
      setLoading(false)
      return
    }

    const ctrl = new AbortController()
    setLoading(true)
    setError(null)

    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.allSettled(
      missing.map(w =>
        dataSourceService.metadata(
          w.id,
          { nameFilter, page: w.page, pageSize },
          { signal: ctrl.signal },
        ),
      ),
    )
      .then(results => {
        // console.log('metadata results', results)
        if (ctrl.signal.aborted) return
        const failed: string[] = []

        results.forEach((r, i) => {
          const w = missing[i]
          if (!w) return
          if (r.status === 'rejected') {
            failed.push(w.id)
            return
          }
          const d = r.value.data
          cache.current.set(w.key, {
            tags: d.tags,
            hasNext: d.hasNext === true,
          })
        })

        setPages(
          new Map(
            wanted
              .map(w => [w.id, cache.current.get(w.key)] as const)
              .filter((e): e is [string, PageResult] => e[1] !== undefined),
          ),
        )
        setError(
          failed.length
            ? `Metadata unavailable for ${failed.length}/${ids.length} source(s).`
            : null,
        )
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })

    // cancelled flag เดิมปิดแค่ setState — request ยังค้างใน threadpool
    return () => ctrl.abort()
  }, [wantKey, idsKey, nameFilter, pageSize])

  const { metaByTag, tagsBySource, hasNextBySource } = useMemo(() => {
    const meta = new Map<string, TagMeta>()
    const bySource = new Map<string, string[]>()
    const hasNext = new Map<string, boolean>()
    for (const [id, page] of pages) {
      hasNext.set(id, page.hasNext)
      bySource.set(
        id,
        page.tags.map(t => t.tag_name),
      )
      for (const t of page.tags) meta.set(tagKey(id, t.tag_name), toMeta(t))
    }
    return { metaByTag: meta, tagsBySource: bySource, hasNextBySource: hasNext }
  }, [pages])

  const goto = useCallback(
    (id: string, page: number) =>
      setPageBySource(prev => new Map(prev).set(id, Math.max(1, page))),
    [],
  )

  const refetch = useCallback(() => {
    for (const key of [...cache.current.keys()]) cache.current.delete(key)
    setReloadNonce(n => n + 1)
  }, [wantKey, idsKey, nameFilter, pageSize, enabled, reloadNonce])

  return {
    metaByTag,
    tagsBySource,
    hasNextBySource,
    pageBySource,
    goto,
    refetch,
    loading,
    error,
  }
}
