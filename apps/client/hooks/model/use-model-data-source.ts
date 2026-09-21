'use client'

import { useCallback, useState } from 'react'
import {
  inferenceWindowService,
  type InferenceSchedule,
  type ScheduleSourceRef,
} from '@/services/inference-window'
import { describeRelink, type RelinkView } from '@/lib/model-data-source'
import { useDebouncedAbortableRequest } from '@/hooks/dataset/internal/use-debounced-abortable-request'

interface UseModelDataSourceResult {
  currentSource: ScheduleSourceRef | null
  candidates: ScheduleSourceRef[]
  view: RelinkView
  /** The id the user has chosen — equal to `currentSource.id` until they
   *  pick something else. Null only before the first read resolves. */
  selectedId: string | null
  setSelectedId: (id: string) => void
  isDirty: boolean
  loading: boolean
  error: string | null
  /** Persists the chosen source. Throws the server's own message on
   *  refusal, for the caller to surface verbatim. */
  save: () => Promise<void>
}

/**
 * MODEL-SERVE-013-T05. The Edit dialog's Data Source section.
 *
 * READ AND WRITE BOTH GO THROUGH THE SCHEDULE, because
 * `InferenceSchedule.sourceId` is the ONLY place a model is bound to a
 * `DataSource` — `Model.datasetId` names a dataset, and a dataset names
 * several possible sources. This is `getSchedule`'s first client caller.
 *
 * `enabled` IS ECHOED BACK VERBATIM on save, never hard-coded.
 * `putSchedule` takes `enabled` as a required field and ACTS on it:
 * sending `false` for a running model would stop it and cancel its queued
 * windows, so changing a source from this dialog would silently take the
 * model down. Sending `true` for a stopped one would start it. The value
 * read is the value written.
 *
 * NO RETRAIN, BY DESIGN. Relinking re-points where live readings are
 * fetched from; the model keeps the weights it was trained with. The
 * dialog says so before it writes — this hook only persists the choice.
 */
export function useModelDataSource(
  modelId: string | null,
  open: boolean,
): UseModelDataSourceResult {
  const [schedule, setSchedule] = useState<InferenceSchedule | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Read only while the dialog is actually open: this is a settings
  // surface, and a model page whose Edit button is never pressed has no
  // reason to spend a round trip on it. Built on the same abort/cache
  // primitive `use-inference-status` uses, whose `onIdle` owns the reset
  // when the dialog closes.
  const enabled = open && !!modelId
  useDebouncedAbortableRequest<InferenceSchedule>({
    enabled,
    cacheKey: enabled ? `model-schedule|${modelId}` : null,
    // A dialog opening is a discrete event, not a keystroke to debounce.
    debounceMs: 0,
    // Every open follows whatever the last save did, so a cached answer
    // could show the source the user just changed away from.
    skipCache: true,
    fetcher: () => inferenceWindowService.getSchedule(modelId as string),
    onLoading: () => {
      setLoading(true)
      setError(null)
    },
    onSettled: result => {
      setLoading(false)
      if (result.status === 'ready') {
        setSchedule(result.data)
        setSelectedId(result.data.currentSource?.id ?? null)
        setError(null)
      } else {
        setSchedule(null)
        setError(result.error)
      }
    },
    onIdle: () => {
      setSchedule(null)
      setSelectedId(null)
      setLoading(false)
      setError(null)
    },
  })

  const currentSource = schedule?.currentSource ?? null
  const candidates = schedule?.sourceCandidates ?? []
  const view = describeRelink({ currentSource, sourceCandidates: candidates })
  const isDirty = !!selectedId && selectedId !== currentSource?.id

  const save = useCallback(async () => {
    if (!modelId || !schedule || !selectedId) return
    await inferenceWindowService.putSchedule(modelId, {
      // See this hook's own doc: the schedule's CURRENT enabled state, so a
      // relink never starts or stops the model as a side effect.
      enabled: schedule.enabled,
      sourceId: selectedId,
    })
  }, [modelId, schedule, selectedId])

  return {
    currentSource,
    candidates,
    view,
    selectedId,
    setSelectedId,
    isDirty,
    loading,
    error,
    save,
  }
}
