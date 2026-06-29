import { useCallback } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { preprocess, type FillStrategyConfig } from '@/lib/preprocessing'
import { METRIC_KEYS } from '@/lib/model-metrics'
import {
  MP_TOTAL_STEPS,
  mpCurrentStepAtom,
  mpHighestUnlockedAtom,
  mpDataSourceAtom,
  mpDataSourceCredentialsAtom,
  mpSelectedSavedSourceIdAtom,
  mpTagListAtom,
  mpSelectedTagsAtom,
  mpTimeRangeAtom,
  mpCustomDateRangeAtom,
  mpFetchStateAtom,
  mpRawDatasetAtom,
  mpFillStrategiesAtom,
  mpNameAtom,
  mpWorkspaceIdAtom,
  mpTrainStateAtom,
  mpCreatedModelIdAtom,
  mpSelectedMetricsAtom,
  mpTagInputMethodAtom,
  mpManualTagsRawAtom,
  mpEditedTagsAtom,
  mpRemovedTagsAtom,
  mpHasInvalidTagsAtom,
  mpInsertedTagsAtom,
  type SavedDataSource,
  type FetchPeriod,
  type TagInputMethod,
} from '@/store/model-pipeline'
import type { CustomDateRange } from '@/store/data-visualize'

const DEFAULT_RANGE: FetchPeriod = '1min'

export interface UsePipelineNavResult {
  currentStep: number
  highestUnlocked: number
  customDateRange: CustomDateRange | null
  selectedSavedSourceId: string
  tagInputMethod: TagInputMethod
  editedTags: Record<string, string>
  removedTags: string[]
  hasInvalidTags: boolean
  goTo: (step: number) => void
  next: () => void
  back: () => void
  canAdvance: (step: number) => boolean
  setSelectedSavedSource: (source: SavedDataSource) => void
  setValidationSource: (source: SavedDataSource) => void
  clearValidationSource: () => void
  setTagInputMethod: (method: TagInputMethod) => void
  setSelectedTags: (tags: string[]) => void
  setEditedTag: (original: string, corrected: string) => void
  removeTag: (original: string) => void
  setHasInvalidTags: (value: boolean) => void
  setTimeRange: (range: FetchPeriod) => void
  setCustomRange: (from: string, to: string) => void
  clearCustomRange: () => void
  setFillStrategies: (
    update: React.SetStateAction<Record<string, FillStrategyConfig>>,
  ) => void
  resetPipeline: () => void
  insertedTags: string[]
  insertTag: (tag: string) => void
  removeInsertedTag: (tag: string) => void
}

/**
 * Wizard navigation + cascade invalidation for the 6-phase Create Model flow:
 * 1 Details · 2 Connect Data & Tags · 3 Raw Data · 4 Processing · 5 Training ·
 * 6 Results. All gating is self-contained (reads metadata + pipeline atoms).
 */
export function useModelPipelineNav(): UsePipelineNavResult {
  const [currentStep, setCurrentStep] = useAtom(mpCurrentStepAtom)
  const [highestUnlocked, setHighestUnlocked] = useAtom(mpHighestUnlockedAtom)

  const name = useAtomValue(mpNameAtom)
  const workspaceId = useAtomValue(mpWorkspaceIdAtom)
  const [tagInputMethod, setTagInputMethodAtom] = useAtom(mpTagInputMethodAtom)
  const manualTagsRaw = useAtomValue(mpManualTagsRawAtom)

  const setDataSource = useSetAtom(mpDataSourceAtom)
  const setCredentials = useSetAtom(mpDataSourceCredentialsAtom)
  const [selectedSavedSourceId, setSelectedSavedSourceId] = useAtom(
    mpSelectedSavedSourceIdAtom,
  )
  const setTagList = useSetAtom(mpTagListAtom)
  const [selectedTags, setSelectedTagsAtom] = useAtom(mpSelectedTagsAtom)
  const setTimeRangeAtom = useSetAtom(mpTimeRangeAtom)
  const [customDateRange, setCustomDateRange] = useAtom(mpCustomDateRangeAtom)
  const fetchState = useAtomValue(mpFetchStateAtom)
  const setFetchState = useSetAtom(mpFetchStateAtom)
  const rawDataset = useAtomValue(mpRawDatasetAtom)
  const setRawDataset = useSetAtom(mpRawDatasetAtom)
  const [fillStrategies, setFillStrategiesAtom] = useAtom(mpFillStrategiesAtom)
  const trainState = useAtomValue(mpTrainStateAtom)
  const setTrainState = useSetAtom(mpTrainStateAtom)
  const setCreatedModelId = useSetAtom(mpCreatedModelIdAtom)
  const setSelectedMetrics = useSetAtom(mpSelectedMetricsAtom)
  const [editedTags, setEditedTagsAtom] = useAtom(mpEditedTagsAtom)
  const [removedTags, setRemovedTagsAtom] = useAtom(mpRemovedTagsAtom)
  const [hasInvalidTags, setHasInvalidTagsAtom] = useAtom(mpHasInvalidTagsAtom)

  const [insertedTags, setInsertedTagsAtom] = useAtom(mpInsertedTagsAtom)

  const insertTag = useCallback(
    (tag: string) => {
      setInsertedTagsAtom(prev => (prev.includes(tag) ? prev : [...prev, tag]))
    },
    [setInsertedTagsAtom],
  )

  const removeInsertedTag = useCallback(
    (tag: string) => {
      setInsertedTagsAtom(prev => prev.filter(t => t !== tag))
    },
    [setInsertedTagsAtom],
  )

  const resetTraining = useCallback(() => {
    setTrainState({ status: 'idle', progress: 0 })
  }, [setTrainState])

  const canAdvance = useCallback(
    (step: number): boolean => {
      switch (step) {
        case 1:
          return name.trim() !== '' && workspaceId !== ''
        case 2: {
          if (tagInputMethod === '') return false
          if (tagInputMethod === 'direct') return selectedSavedSourceId !== ''
          return manualTagsRaw.trim() !== ''
        }
        case 3: {
          if (tagInputMethod === 'direct') return selectedTags.length > 0
          return (
            selectedSavedSourceId !== '' &&
            !hasInvalidTags &&
            selectedTags.length > 0
          )
        }
        case 4:
          return fetchState.status === 'done' && rawDataset.rows.length > 0
        case 5:
          return preprocess(rawDataset, fillStrategies).rows.length > 0
        case 6:
          return trainState.status === 'done'
        case 7:
          return false
        default:
          return false
      }
    },
    [
      name,
      workspaceId,
      tagInputMethod,
      manualTagsRaw,
      selectedSavedSourceId,
      hasInvalidTags,
      selectedTags,
      fetchState,
      rawDataset,
      fillStrategies,
      trainState,
    ],
  )

  const goTo = useCallback(
    (step: number) => {
      if (step < 1 || step > MP_TOTAL_STEPS) return
      if (step > highestUnlocked) return
      setCurrentStep(step)
    },
    [highestUnlocked, setCurrentStep],
  )

  const next = useCallback(() => {
    if (!canAdvance(currentStep)) return
    const target = Math.min(currentStep + 1, MP_TOTAL_STEPS)
    setCurrentStep(target)
    setHighestUnlocked(prev => Math.max(prev, target))
  }, [canAdvance, currentStep, setCurrentStep, setHighestUnlocked])

  const back = useCallback(() => {
    setCurrentStep(prev => Math.max(1, prev - 1))
  }, [setCurrentStep])

  const setTagInputMethod = useCallback(
    (method: TagInputMethod) => {
      setTagInputMethodAtom(method)
      setSelectedSavedSourceId('')
      setTagList([])
      setSelectedTagsAtom([])
      setEditedTagsAtom({})
      setRemovedTagsAtom([])
      setInsertedTagsAtom([])
      setHasInvalidTagsAtom(false)
      setFetchState({ status: 'idle', progress: 0 })
      setRawDataset({ tags: [], rows: [] })
      setFillStrategiesAtom({})
      resetTraining()
      setHighestUnlocked(prev => Math.min(prev, 2))
    },
    [
      setTagInputMethodAtom,
      setSelectedSavedSourceId,
      setTagList,
      setSelectedTagsAtom,
      setEditedTagsAtom,
      setRemovedTagsAtom,
      setInsertedTagsAtom,
      setHasInvalidTagsAtom,
      setFetchState,
      setRawDataset,
      setFillStrategiesAtom,
      resetTraining,
      setHighestUnlocked,
    ],
  )

  const setValidationSource = useCallback(
    (source: SavedDataSource) => {
      setSelectedSavedSourceId(source.id)
      setDataSource(source.type)
      setCredentials({
        host: source.host,
        username: source.username,
        password: source.password,
        dbName: source.dbName,
      })
      setEditedTagsAtom({})
      setRemovedTagsAtom([])
      setHasInvalidTagsAtom(false)
      setSelectedTagsAtom([])
    },
    [
      setSelectedSavedSourceId,
      setDataSource,
      setCredentials,
      setEditedTagsAtom,
      setRemovedTagsAtom,
      setHasInvalidTagsAtom,
      setSelectedTagsAtom,
    ],
  )

  const clearValidationSource = useCallback(() => {
    setSelectedSavedSourceId('')
    setEditedTagsAtom({})
    setRemovedTagsAtom([])
    setHasInvalidTagsAtom(false)
    setSelectedTagsAtom([])
  }, [
    setSelectedSavedSourceId,
    setEditedTagsAtom,
    setRemovedTagsAtom,
    setHasInvalidTagsAtom,
    setSelectedTagsAtom,
  ])

  const setEditedTag = useCallback(
    (original: string, corrected: string) => {
      setEditedTagsAtom(prev => ({ ...prev, [original]: corrected }))
    },
    [setEditedTagsAtom],
  )

  const removeTag = useCallback(
    (original: string) => {
      setRemovedTagsAtom(prev => [...prev, original])
    },
    [setRemovedTagsAtom],
  )

  const setHasInvalidTags = useCallback(
    (value: boolean) => {
      setHasInvalidTagsAtom(value)
    },
    [setHasInvalidTagsAtom],
  )

  const setSelectedSavedSource = useCallback(
    (source: SavedDataSource) => {
      setSelectedSavedSourceId(source.id)
      setDataSource(source.type)
      setCredentials({
        host: source.host,
        username: source.username,
        password: source.password,
        dbName: source.dbName,
      })
      setTagList([])
      setSelectedTagsAtom([])
      setTimeRangeAtom(DEFAULT_RANGE)
      setCustomDateRange(null)
      setFetchState({ status: 'idle', progress: 0 })
      setRawDataset({ tags: [], rows: [] })
      setFillStrategiesAtom({})
      resetTraining()
      setHighestUnlocked(prev => Math.min(prev, 2))
    },
    [
      setSelectedSavedSourceId,
      setDataSource,
      setCredentials,
      setTagList,
      setSelectedTagsAtom,
      setTimeRangeAtom,
      setCustomDateRange,
      setFetchState,
      setRawDataset,
      setFillStrategiesAtom,
      resetTraining,
      setHighestUnlocked,
    ],
  )

  const setSelectedTags = useCallback(
    (tags: string[]) => {
      setSelectedTagsAtom(tags)
      setFetchState({ status: 'idle', progress: 0 })
      setRawDataset({ tags: [], rows: [] })
      setFillStrategiesAtom(
        prev =>
          Object.fromEntries(
            Object.entries(prev).filter(([tag]) => tags.includes(tag)),
          ) as Record<string, FillStrategyConfig>,
      )
      resetTraining()
      setHighestUnlocked(prev => Math.min(prev, 2))
    },
    [
      setSelectedTagsAtom,
      setFetchState,
      setRawDataset,
      setFillStrategiesAtom,
      resetTraining,
      setHighestUnlocked,
    ],
  )

  const setTimeRange = useCallback(
    (range: FetchPeriod) => {
      setTimeRangeAtom(range)
      setCustomDateRange(null)
      setFetchState({ status: 'idle', progress: 0 })
      setRawDataset({ tags: [], rows: [] })
      resetTraining()
      setHighestUnlocked(prev => Math.min(prev, 3))
    },
    [
      setTimeRangeAtom,
      setCustomDateRange,
      setFetchState,
      setRawDataset,
      resetTraining,
      setHighestUnlocked,
    ],
  )

  const setCustomRange = useCallback(
    (from: string, to: string) => {
      setCustomDateRange({ from, to })
      setFetchState({ status: 'idle', progress: 0 })
      setRawDataset({ tags: [], rows: [] })
      resetTraining()
      setHighestUnlocked(prev => Math.min(prev, 3))
    },
    [
      setCustomDateRange,
      setFetchState,
      setRawDataset,
      resetTraining,
      setHighestUnlocked,
    ],
  )

  const clearCustomRange = useCallback(() => {
    setCustomDateRange(null)
    setFetchState({ status: 'idle', progress: 0 })
    setRawDataset({ tags: [], rows: [] })
    resetTraining()
    setHighestUnlocked(prev => Math.min(prev, 3))
  }, [
    setCustomDateRange,
    setFetchState,
    setRawDataset,
    resetTraining,
    setHighestUnlocked,
  ])

  // Changing a fill rule relocks Training/Results and discards the prior run so
  // metrics never reflect a stale dataset. Does NOT clear the created model id.
  const setFillStrategies = useCallback(
    (update: React.SetStateAction<Record<string, FillStrategyConfig>>) => {
      setFillStrategiesAtom(update)
      resetTraining()
      setHighestUnlocked(prev => Math.min(prev, 4))
    },
    [setFillStrategiesAtom, resetTraining, setHighestUnlocked],
  )

  // Full reset for a new model context (workspace/plant change). Leaves the
  // metadata atoms (owned by useCreateModel) untouched.
  const resetPipeline = useCallback(() => {
    setTagInputMethodAtom('')
    setDataSource('')
    setCredentials(null)
    setSelectedSavedSourceId('')
    setTagList([])
    setSelectedTagsAtom([])
    setEditedTagsAtom({})
    setRemovedTagsAtom([])
    setHasInvalidTagsAtom(false)
    setTimeRangeAtom(DEFAULT_RANGE)
    setCustomDateRange(null)
    setFetchState({ status: 'idle', progress: 0 })
    setRawDataset({ tags: [], rows: [] })
    setFillStrategiesAtom({})
    setTrainState({ status: 'idle', progress: 0 })
    setCreatedModelId('')
    setSelectedMetrics([...METRIC_KEYS])
    setHighestUnlocked(1)
    setCurrentStep(1)
  }, [
    setTagInputMethodAtom,
    setDataSource,
    setCredentials,
    setSelectedSavedSourceId,
    setTagList,
    setSelectedTagsAtom,
    setEditedTagsAtom,
    setRemovedTagsAtom,
    setHasInvalidTagsAtom,
    setTimeRangeAtom,
    setCustomDateRange,
    setFetchState,
    setRawDataset,
    setFillStrategiesAtom,
    setTrainState,
    setCreatedModelId,
    setSelectedMetrics,
    setHighestUnlocked,
    setCurrentStep,
  ])

  return {
    currentStep,
    highestUnlocked,
    customDateRange,
    selectedSavedSourceId,
    tagInputMethod,
    editedTags,
    removedTags,
    hasInvalidTags,
    goTo,
    next,
    back,
    canAdvance,
    setSelectedSavedSource,
    setValidationSource,
    clearValidationSource,
    setTagInputMethod,
    setSelectedTags,
    setEditedTag,
    removeTag,
    setHasInvalidTags,
    setTimeRange,
    setCustomRange,
    clearCustomRange,
    setFillStrategies,
    resetPipeline,
    insertedTags,
    insertTag,
    removeInsertedTag,
  }
}
