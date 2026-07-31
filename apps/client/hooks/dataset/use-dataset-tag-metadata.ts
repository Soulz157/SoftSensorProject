'use client'

import { useEffect, useState } from 'react'
import { useAtomValue } from 'jotai'
import { dwSelectedSourcesAtom } from '@/store/dataset-studio'
import { dataSourceService, type TagMetaItem } from '@/services/data-sources'

export type TagQuality = 'good' | 'questionable' | 'bad' | 'unknown'

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
  /**
   * Real PI tag names per source id. The tag table builds its rows from these
   * so `originalName` matches the `metaByTag` keys — building rows from the
   * mock catalogue instead is what made every lookup miss.
   */
  tagsBySource: Map<string, string[]>
  loading: boolean
  error: string | null
}

/**
 * Fetch enriched tag metadata (value / unit / point-type / quality) for the
 * selected PI sources and key it by tag name — metadata only, NO archive read.
 * Non-blocking: the table renders immediately and fills these columns in when
 * the map resolves. Bounded by `maxCount` (server-side pagination is a
 * follow-up for very large PI systems).
 */
export function useDatasetTagMetadata(maxCount = 1000): Result {
  const sources = useAtomValue(dwSelectedSourcesAtom)
  const [metaByTag, setMetaByTag] = useState<Map<string, TagMeta>>(new Map())
  const [tagsBySource, setTagsBySource] = useState<Map<string, string[]>>(
    new Map(),
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const piSourceIds = sources
    .filter(s => s.type === 'aveva')
    .map(s => s.id)
    .join(',')

  useEffect(() => {
    const ids = piSourceIds ? piSourceIds.split(',') : []
    if (ids.length === 0) {
      setMetaByTag(new Map())
      setTagsBySource(new Map())
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all(
      ids.map(id =>
        dataSourceService
          .metadata(id, { nameFilter: '*', maxCount })
          .then(res => res.data.tags)
          .catch(() => [] as TagMetaItem[]),
      ),
    )
      .then(perSource => {
        if (cancelled) return
        const map = new Map<string, TagMeta>()
        // `perSource` preserves the order of `ids`, so index i belongs to ids[i].
        const bySource = new Map<string, string[]>()
        perSource.forEach((tags, i) => {
          const id = ids[i]
          if (id)
            bySource.set(
              id,
              tags.map(t => t.tag_name),
            )
          for (const item of tags) map.set(item.tag_name, toMeta(item))
        })
        setMetaByTag(map)
        setTagsBySource(bySource)
        if (map.size === 0) {
          setError('No tag metadata returned for the selected PI source(s).')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [piSourceIds, maxCount])

  return { metaByTag, tagsBySource, loading, error }
}
