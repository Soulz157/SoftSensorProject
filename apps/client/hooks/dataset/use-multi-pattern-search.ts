'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAtomValue } from 'jotai'
import { dwSelectedSourcesAtom } from '@/store/dataset-studio'
import { dataSourceService, type TagMetaItem } from '@/services/data-sources'
import {
  deriveTagQuality,
  tagKey,
  type TagMeta,
} from './use-dataset-tag-metadata'

/** Rows fetched per pattern per source. Two patterns × 200 ≈ 2.5 s. */
export const PATTERN_CAP = 200
/** Guard against a paste of thirty patterns turning into sixty PI queries. */
export const MAX_PATTERNS = 10

interface PatternPage {
  tags: TagMetaItem[]
  /** PI has more matches than the cap — results for this pattern are partial. */
  truncated: boolean
}

export interface UseMultiPatternSearchResult {
  metaByTag: Map<string, TagMeta>
  tagsBySource: Map<string, string[]>
  /** Patterns that hit the cap. Their result sets are incomplete. */
  truncatedPatterns: string[]
  /** Patterns no source matched at all. */
  emptyPatterns: string[]
  /** Patterns beyond MAX_PATTERNS that were never queried. */
  droppedPatterns: string[]
  loading: boolean
  /** The QUERY failed — not "nothing matched". Keep the two distinct in the UI. */
  error: string | null
  refetch: () => void
}

function toMeta(item: TagMetaItem): TagMeta {
  const meta = {
    tagName: item.tag_name,
    description: item.description,
    value: item.value,
    unit: item.unit,
    pointType: item.point_type,
    isGood: item.isGood,
    questionable: item.questionable,
    substituted: item.substituted,
    timestamp: item.timestamp,
  }
  return { ...meta, quality: deriveTagQuality(meta) }
}

/**
 * Run several PI wildcard patterns at once and merge the results.
 *
 * PI's `name_filter` takes ONE pattern per request — there is no `AI* OR FIC*`
 * — so "search two prefixes together" is inherently pattern-count requests,
 * merged client-side.
 *
 * Page 1 only, capped per pattern. Paging is deliberately absent: with N
 * patterns × M sources there is no single cursor to advance, and a merged view
 * where one pattern is on page 3 and another on page 1 is not something a user
 * can reason about. Narrowing the pattern is the answer to a truncated result,
 * not a Next button.
 */
export function useMultiPatternSearch(
  patterns: string[],
  pageSize = PATTERN_CAP,
  includeQuality = true,
): UseMultiPatternSearchResult {
  const sources = useAtomValue(dwSelectedSourcesAtom)
  const [pages, setPages] = useState<Map<string, PatternPage>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)

  // `${sourceId}::${pattern}` → PatternPage
  const cache = useRef(new Map<string, PatternPage>())

  const ids = useMemo(
    () => sources.filter(s => s.type === 'aveva').map(s => s.id),
    [sources],
  )
  const idsKey = JSON.stringify(ids)

  const active = useMemo(() => patterns.slice(0, MAX_PATTERNS), [patterns])
  const droppedPatterns = useMemo(
    () => patterns.slice(MAX_PATTERNS),
    [patterns],
  )
  const patternsKey = JSON.stringify(active)

  useEffect(() => {
    cache.current.clear()
  }, [pageSize, includeQuality])

  useEffect(() => {
    const list: string[] = JSON.parse(patternsKey)
    if (list.length === 0 || ids.length === 0) {
      setPages(new Map())
      setError(null)
      setLoading(false)
      return
    }

    const wanted = ids.flatMap(id =>
      list.map(pattern => ({ id, pattern, key: `${id}::${pattern}` })),
    )

    const commit = () => {
      const next = new Map<string, PatternPage>()
      for (const w of wanted) {
        const hit = cache.current.get(w.key)
        if (hit) next.set(w.key, hit)
      }
      setPages(next)
    }

    const missing = wanted.filter(w => !cache.current.has(w.key))
    if (missing.length === 0) {
      commit()
      setError(null)
      setLoading(false)
      return
    }

    const ctrl = new AbortController()
    setLoading(true)
    setError(null)

    Promise.allSettled(
      missing.map(w =>
        dataSourceService.metadata(
          w.id,
          {
            nameFilter: w.pattern,
            page: 1,
            pageSize,
          },
          { signal: ctrl.signal },
        ),
      ),
    )
      .then(results => {
        if (ctrl.signal.aborted) return
        const failed: string[] = []

        results.forEach((r, i) => {
          const w = missing[i]
          if (!w) return
          if (r.status === 'rejected') {
            failed.push(`${w.pattern}`)
            return
          }
          const d = r.value.data
          cache.current.set(w.key, {
            tags: d.tags ?? [],
            // `hasNext === true` guards against a null/`[null]` artefact from a
            // wrongly-defaulted server field being read as truthy.
            truncated: d.hasNext === true,
          })
        })

        commit()
        setError(
          failed.length
            ? `Could not search ${failed.length} of ${missing.length} pattern/source combination(s).`
            : null,
        )
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })

    return () => ctrl.abort()
  }, [patternsKey, idsKey, pageSize, includeQuality, reloadNonce]) // eslint-disable-line react-hooks/exhaustive-deps

  const derived = useMemo(() => {
    const meta = new Map<string, TagMeta>()
    const bySource = new Map<string, string[]>()
    const truncated = new Set<string>()
    const matched = new Set<string>()

    // Iterate in the user's pattern order so overlapping patterns (`AI*` and
    // `AI002*`) resolve deterministically — first writer wins per source+tag,
    // which is also what dedupes them.
    for (const id of ids) {
      for (const pattern of active) {
        const page = pages.get(`${id}::${pattern}`)
        if (!page) continue
        if (page.truncated) truncated.add(pattern)
        if (page.tags.length > 0) matched.add(pattern)
        const list = bySource.get(id) ?? []
        for (const t of page.tags) {
          const key = tagKey(id, t.tag_name)
          if (meta.has(key)) continue
          meta.set(key, toMeta(t))
          list.push(t.tag_name)
        }
        bySource.set(id, list)
      }
    }

    return {
      metaByTag: meta,
      tagsBySource: bySource,
      truncatedPatterns: [...truncated],
      // Only patterns every source has answered for count as empty; one still
      // in flight must not render as "no matches".
      emptyPatterns: active.filter(
        p => !matched.has(p) && ids.every(id => pages.has(`${id}::${p}`)),
      ),
    }
  }, [pages, ids, active])

  // reloadNonce IS in the effect deps above. Clearing a cache the effect does
  // not depend on is the silent-Refresh bug.
  const refetch = useCallback(() => {
    cache.current.clear()
    setReloadNonce(n => n + 1)
  }, [])

  return { ...derived, droppedPatterns, loading, error, refetch }
}
