import { useCallback, useRef } from 'react'
import { useAtom } from 'jotai'
import { MOCK_PI_TAGS } from '@/lib/mock-readings'
import { mpTagListAtom } from '@/store/model-pipeline'
import type { DiscoveredTag, TagDiscoveryStatus } from '@/store/data-visualize'

export type TagListStatus = 'idle' | 'fetching' | 'done'

export interface UseModelTagListFetchResult {
  tags: DiscoveredTag[]
  status: TagListStatus
  start: () => void
  retry: () => void
}

const STEP_MS = 300
const ERROR_TAG = 'FI-404'

export function useModelTagListFetch(): UseModelTagListFetchResult {
  const [tags, setTags] = useAtom(mpTagListAtom)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const run = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)

    setTags(
      MOCK_PI_TAGS.map(t => ({
        piTag: t.piTag,
        label: t.label,
        description: t.description,
        unit: t.unit,
        chartIndex: t.chartIndex,
        status: 'fetching' as const,
      })),
    )

    let i = 0
    timerRef.current = setInterval(() => {
      const tag = MOCK_PI_TAGS[i]
      i += 1
      if (!tag) {
        if (timerRef.current) clearInterval(timerRef.current)
        timerRef.current = null
        return
      }
      const piTag = tag.piTag
      const resolved: TagDiscoveryStatus =
        piTag === ERROR_TAG ? 'error' : 'complete'
      setTags(prev =>
        prev.map(t => (t.piTag === piTag ? { ...t, status: resolved } : t)),
      )
    }, STEP_MS)
  }, [setTags])

  const status: TagListStatus =
    tags.length === 0
      ? 'idle'
      : tags.some(t => t.status === 'fetching')
        ? 'fetching'
        : 'done'

  return { tags, status, start: run, retry: run }
}
