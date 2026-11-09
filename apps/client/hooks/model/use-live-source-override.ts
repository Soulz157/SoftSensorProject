'use client'

import { useCallback, useMemo, useState } from 'react'
import { dataSourceService } from '@/services/data-sources'
import {
  inferenceWindowService,
  type InferenceSchedule,
} from '@/services/inference-window'
import { useTagResolution } from '@/hooks/dataset/use-tag-resolution'
import { useDebouncedAbortableRequest } from '@/hooks/dataset/internal/use-debounced-abortable-request'
import {
  buildMappingRows,
  summarizeMapping,
  toColumnTagMap,
  type MappingRow,
  type MappingSummary,
} from '@/lib/live-source-mapping'
import type { SavedDataSource } from '@/lib/mock-data-sources'

export interface LiveSourceForm {
  sourceId: string | null
  intervalTime: string
  calcType: string
  calcBasis: string
  /** Training column -> PI tag the user typed; absent = its own name. */
  map: Record<string, string>
}

export interface UseLiveSourceOverrideResult {
  /** False when the model does not need an override — render nothing. */
  active: boolean
  /** PI sources shared with the model's workspace (the only ones allowed). */
  sources: SavedDataSource[]
  sourcesLoading: boolean
  form: LiveSourceForm
  setSourceId: (id: string) => void
  setFetch: (patch: Partial<Omit<LiveSourceForm, 'sourceId' | 'map'>>) => void
  setTag: (column: string, tag: string) => void
  rows: MappingRow[]
  summary: MappingSummary
  /** The training columns could not be read — nothing can be mapped. */
  columnsUnavailable: boolean
  checking: boolean
  checkError: string | null
  isDirty: boolean
  /** Throws a readable reason when the mapping is incomplete or refused. */
  save: () => Promise<void>
}

const DEFAULT_FORM: LiveSourceForm = {
  sourceId: null,
  intervalTime: '1m',
  calcType: 'Average',
  calcBasis: 'TimeWeighted',
  map: {},
}

function initialForm(schedule: InferenceSchedule | null): LiveSourceForm {
  const current = schedule?.liveSource?.current
  if (!schedule || !current) return DEFAULT_FORM
  return {
    sourceId: schedule.sourceId,
    intervalTime: current.intervalTime,
    calcType: current.calcType,
    calcBasis: current.calcBasis,
    // Only real remaps are kept as entries; identity rows read their own name.
    map: Object.fromEntries(
      Object.entries(current.columnTagMap).filter(([c, t]) => c !== t),
    ),
  }
}

/**
 * MODEL-SERVE-037-T05. The Edit dialog's live source section for a model
 * trained on an uploaded CSV: pick a PI source shared with the model's
 * workspace, its summary settings, and the PI tag behind each training
 * column. Every tag is checked against the chosen source by name (the same
 * `resolveTags` lookup the preset Apply Mapping sheet uses); save is
 * refused until every input resolves.
 *
 * `enabled` is echoed back on save, as `useModelDataSource` does: binding a
 * source never starts or stops the model.
 */
export function useLiveSourceOverride(input: {
  modelId: string | null
  workspaceId: string | null
  schedule: InferenceSchedule | null
}): UseLiveSourceOverrideResult {
  const { modelId, workspaceId, schedule } = input
  const info = schedule?.liveSource ?? null
  const active = !!info?.required

  // Re-seed the form whenever a NEW schedule read arrives (dialog reopened
  // or saved), during render rather than in an effect.
  const [seededFrom, setSeededFrom] = useState<InferenceSchedule | null>(null)
  const [form, setForm] = useState<LiveSourceForm>(DEFAULT_FORM)
  if (schedule !== seededFrom) {
    setSeededFrom(schedule)
    setForm(initialForm(schedule))
  }

  const [sources, setSources] = useState<SavedDataSource[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(false)
  const listEnabled = active && !!workspaceId
  useDebouncedAbortableRequest<SavedDataSource[]>({
    enabled: listEnabled,
    cacheKey: listEnabled ? `live-source-pi|${workspaceId}` : null,
    debounceMs: 0,
    skipCache: true,
    fetcher: async () => (await dataSourceService.list()).data,
    onLoading: () => setSourcesLoading(true),
    onSettled: result => {
      setSourcesLoading(false)
      setSources(
        result.status === 'ready'
          ? result.data.filter(
              s => s.type === 'aveva' && s.workspaceId === workspaceId,
            )
          : [],
      )
    },
    onIdle: () => {
      setSources([])
      setSourcesLoading(false)
    },
  })

  const columns = useMemo(() => info?.columns ?? [], [info])
  const target = info?.target ?? null

  const tagNames = useMemo(() => {
    if (!form.sourceId) return []
    const names = buildMappingRows({
      columns,
      target,
      map: form.map,
      found: new Set(),
      notFound: new Set(),
    }).map(r => r.tag)
    return [...new Set(names)]
  }, [columns, target, form.map, form.sourceId])
  const sourceIds = useMemo(
    () => (form.sourceId ? [form.sourceId] : []),
    [form.sourceId],
  )
  const resolution = useTagResolution(tagNames, sourceIds)

  const rows = useMemo(
    () =>
      buildMappingRows({
        columns,
        target,
        map: form.map,
        found: new Set(resolution.resolved.keys()),
        notFound: new Set(resolution.notFound),
      }),
    [columns, target, form.map, resolution.resolved, resolution.notFound],
  )
  const summary = summarizeMapping(rows)

  const isDirty = useMemo(() => {
    if (!active || !form.sourceId) return false
    return JSON.stringify(form) !== JSON.stringify(initialForm(schedule))
  }, [active, form, schedule])

  const setSourceId = useCallback(
    (id: string) => setForm(f => ({ ...f, sourceId: id })),
    [],
  )
  const setFetch = useCallback(
    (patch: Partial<Omit<LiveSourceForm, 'sourceId' | 'map'>>) =>
      setForm(f => ({ ...f, ...patch })),
    [],
  )
  const setTag = useCallback(
    (column: string, tag: string) =>
      setForm(f => ({ ...f, map: { ...f.map, [column]: tag } })),
    [],
  )

  const save = useCallback(async () => {
    if (!modelId || !schedule || !form.sourceId) return
    if (!summary.ready) {
      throw new Error(
        `${summary.attention} training column(s) are not mapped to a PI tag yet.`,
      )
    }
    await inferenceWindowService.putSchedule(modelId, {
      enabled: schedule.enabled,
      liveSource: {
        sourceId: form.sourceId,
        intervalTime: form.intervalTime,
        calcType: form.calcType,
        calcBasis: form.calcBasis,
        columnTagMap: toColumnTagMap(rows),
      },
    })
  }, [modelId, schedule, form, summary, rows])

  return {
    active,
    sources,
    sourcesLoading,
    form,
    setSourceId,
    setFetch,
    setTag,
    rows,
    summary,
    columnsUnavailable: active && info?.columns === null,
    checking: resolution.loading,
    checkError: resolution.error,
    isDirty,
    save,
  }
}
