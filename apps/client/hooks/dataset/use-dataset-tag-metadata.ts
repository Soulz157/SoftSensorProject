'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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

const EMPTY_PAGES: Map<string, PageResult> = new Map()

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

  const [pageBySource, setPageBySource] = useState<Map<string, number>>(
    new Map(),
  )

  // Last settled fetch, tagged with the request it answers. `loading`, the
  // cleared error on a new request and the empty result when disabled are
  // DERIVED from it during render, never set synchronously in the effect.
  const [settled, setSettled] = useState<{
    key: string
    pages: Map<string, PageResult>
    error: string | null
  } | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)

  // Per-instance page cache, held in state (never replaced) so render can
  // read it. Keys carry `pageSize`, so a page of one size is never served
  // for another even before the clear below runs.
  const [cache] = useState(() => new Map<string, PageResult>())

  const ids = useMemo(
    () => sources.filter(s => s.type === 'aveva').map(s => s.id),
    [sources],
  )

  const idsKey = JSON.stringify(ids)

  // Page positions reset on a new filter/size and drop sources that left the
  // selection — adjusted during render (React's "storing information from
  // previous renders" pattern), not in an effect.
  const resetKey = `${nameFilter}|${pageSize}`
  const [prevResetKey, setPrevResetKey] = useState(resetKey)
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey)
    setPageBySource(new Map())
  }
  const [prevIdsKey, setPrevIdsKey] = useState(idsKey)
  if (prevIdsKey !== idsKey) {
    setPrevIdsKey(idsKey)
    setPageBySource(prev => {
      const next = new Map<string, number>()
      for (const id of ids) {
        const p = prev.get(id)
        if (p !== undefined) next.set(id, p)
      }
      return next.size === prev.size ? prev : next
    })
  }

  useEffect(() => {
    cache.clear()
  }, [cache, nameFilter, pageSize])

  const wanted = useMemo(
    () =>
      ids.map(id => {
        const page = pageBySource.get(id) ?? 1
        return { id, page, key: `${id}::${nameFilter}::${pageSize}::${page}` }
      }),
    [ids, pageBySource, nameFilter, pageSize],
  )
  const wantKey = wanted.map(w => w.key).join('|')
  // `reloadNonce` is part of the request, so Refresh re-runs the effect after
  // clearing the cache instead of waiting on a fetch that never starts.
  const requestKey = JSON.stringify([wantKey, reloadNonce])
  const active = enabled && ids.length > 0
  const allCached = active && wanted.every(w => cache.has(w.key))

  useEffect(() => {
    if (!active) return
    const missing = wanted.filter(w => !cache.has(w.key))
    if (missing.length === 0) return

    const ctrl = new AbortController()

    void Promise.allSettled(
      missing.map(w =>
        dataSourceService.metadata(
          w.id,
          { nameFilter, page: w.page, pageSize },
          { signal: ctrl.signal },
        ),
      ),
    ).then(results => {
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
        cache.set(w.key, {
          tags: d.tags,
          hasNext: d.hasNext === true,
        })
      })

      setSettled({
        key: requestKey,
        pages: new Map(
          wanted
            .map(w => [w.id, cache.get(w.key)] as const)
            .filter((e): e is [string, PageResult] => e[1] !== undefined),
        ),
        error: failed.length
          ? `Metadata unavailable for ${failed.length}/${wanted.length} source(s).`
          : null,
      })
    })

    // cancelled flag เดิมปิดแค่ setState — request ยังค้างใน threadpool
    return () => ctrl.abort()
  }, [active, wanted, requestKey, cache, nameFilter, pageSize])

  // Fully cached: read straight from the cache, no request in flight.
  // Otherwise the last settled pages stay on screen while the next loads,
  // exactly as before; disabled shows nothing.
  const pages = useMemo(
    () =>
      !active
        ? EMPTY_PAGES
        : allCached
          ? new Map(wanted.map(w => [w.id, cache.get(w.key)!] as const))
          : (settled?.pages ?? EMPTY_PAGES),
    // `settled` stands in for cache writes: every write is followed by one.
    [active, allCached, wanted, cache, settled],
  )
  const settledHere = settled?.key === requestKey ? settled : null
  const loading = active && !allCached && settledHere === null
  const error = active && !allCached ? (settledHere?.error ?? null) : null

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
    cache.clear()
    setReloadNonce(n => n + 1)
  }, [cache])

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
