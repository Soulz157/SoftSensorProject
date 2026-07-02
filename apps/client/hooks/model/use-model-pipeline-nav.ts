import { useCallback } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { preprocess, type FillStrategyConfig } from '@/lib/preprocessing'
import {
  precleanse,
  type ConditionalRule,
  type CropRange,
  type StatisticalRule,
} from '@/lib/precleanse'
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
  mpProcessingSubStepAtom,
  mpCropRangeAtom,
  mpConditionalRulesAtom,
  mpStatisticalRulesAtom,
  mpFillStrategiesAtom,
  mpTagConstantsAtom,
  mpNameAtom,
  mpWorkspaceIdAtom,
  mpPlantIdAtom,
  mpNodeIdAtom,
  mpTrainStateAtom,
  mpCreatedModelIdAtom,
  mpSelectedMetricsAtom,
  mpTagInputMethodAtom,
  mpSelectedSavedSourceIdsAtom,
  mpCsvUploadTagsAtom,
  mpEditedTagsAtom,
  mpRemovedTagsAtom,
  mpHasInvalidTagsAtom,
  mpInsertedTagsAtom,
  mpFetchTagsAtom,
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
  selectedSavedSourceIds: string[]
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
  resetFetch: () => void
  fetchTagOverride: string[] | null
  setFetchTagOverride: (tags: string[] | null) => void
  // Phase 5.1 — Data Preprocessing (crop + outlier removal).
  processingSubStep: 1 | 2
  cropRange: CropRange
  conditionalRules: ConditionalRule[]
  statisticalRules: StatisticalRule[]
  setProcessingSubStep: (step: 1 | 2) => void
  setCropRange: (range: CropRange) => void
  setConditionalRules: (update: React.SetStateAction<ConditionalRule[]>) => void
  setStatisticalRules: (update: React.SetStateAction<StatisticalRule[]>) => void
  setFillStrategies: (
    update: React.SetStateAction<Record<string, FillStrategyConfig>>,
  ) => void
  tagConstants: Record<string, number>
  setTagConstant: (tagName: string, value: number | null) => void
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
  const plantId = useAtomValue(mpPlantIdAtom)
  const nodeId = useAtomValue(mpNodeIdAtom)
  const [tagInputMethod, setTagInputMethodAtom] = useAtom(mpTagInputMethodAtom)
  const csvUploadTags = useAtomValue(mpCsvUploadTagsAtom)

  const setDataSource = useSetAtom(mpDataSourceAtom)
  const setCredentials = useSetAtom(mpDataSourceCredentialsAtom)
  const [selectedSavedSourceId, setSelectedSavedSourceId] = useAtom(
    mpSelectedSavedSourceIdAtom,
  )
  const selectedSavedSourceIds = useAtomValue(mpSelectedSavedSourceIdsAtom)
  const setTagList = useSetAtom(mpTagListAtom)
  const [selectedTags, setSelectedTagsAtom] = useAtom(mpSelectedTagsAtom)
  const setTimeRangeAtom = useSetAtom(mpTimeRangeAtom)
  const [customDateRange, setCustomDateRange] = useAtom(mpCustomDateRangeAtom)
  const fetchState = useAtomValue(mpFetchStateAtom)
  const setFetchState = useSetAtom(mpFetchStateAtom)
  const rawDataset = useAtomValue(mpRawDatasetAtom)
  const setRawDataset = useSetAtom(mpRawDatasetAtom)
  const [processingSubStep, setProcessingSubStepAtom] = useAtom(
    mpProcessingSubStepAtom,
  )
  const [cropRange, setCropRangeAtom] = useAtom(mpCropRangeAtom)
  const [conditionalRules, setConditionalRulesAtom] = useAtom(
    mpConditionalRulesAtom,
  )
  const [statisticalRules, setStatisticalRulesAtom] = useAtom(
    mpStatisticalRulesAtom,
  )
  const [fillStrategies, setFillStrategiesAtom] = useAtom(mpFillStrategiesAtom)
  const [tagConstants, setTagConstantsAtom] = useAtom(mpTagConstantsAtom)
  const trainState = useAtomValue(mpTrainStateAtom)
  const setTrainState = useSetAtom(mpTrainStateAtom)
  const setCreatedModelId = useSetAtom(mpCreatedModelIdAtom)
  const setSelectedMetrics = useSetAtom(mpSelectedMetricsAtom)
  const [editedTags, setEditedTagsAtom] = useAtom(mpEditedTagsAtom)
  const [removedTags, setRemovedTagsAtom] = useAtom(mpRemovedTagsAtom)
  const [hasInvalidTags, setHasInvalidTagsAtom] = useAtom(mpHasInvalidTagsAtom)

  const [insertedTags, setInsertedTagsAtom] = useAtom(mpInsertedTagsAtom)
  const [fetchTagOverride, setFetchTagOverrideAtom] = useAtom(mpFetchTagsAtom)

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

  // Discards a completed fetch + downstream Training/Results and relocks past
  // step 4. Call when the Step-4 fetch tag subset changes.
  const resetFetch = useCallback(() => {
    setFetchTagOverrideAtom(null)
    setFetchState({ status: 'idle', progress: 0 })
    setRawDataset({ tags: [], rows: [] })
    resetTraining()
    setHighestUnlocked(prev => Math.min(prev, 4))
  }, [
    setFetchTagOverrideAtom,
    setFetchState,
    setRawDataset,
    resetTraining,
    setHighestUnlocked,
  ])

  const setFetchTagOverride = useCallback(
    (tags: string[] | null) => {
      setFetchTagOverrideAtom(tags)
      setFetchState({ status: 'idle', progress: 0 })
      setRawDataset({ tags: [], rows: [] })
      resetTraining()
      setHighestUnlocked(prev => Math.min(prev, 4))
    },
    [
      setFetchTagOverrideAtom,
      setFetchState,
      setRawDataset,
      resetTraining,
      setHighestUnlocked,
    ],
  )

  const canAdvance = useCallback(
    (step: number): boolean => {
      switch (step) {
        case 1:
          return (
            name.trim() !== '' &&
            workspaceId !== '' &&
            plantId !== '' &&
            nodeId !== ''
          )
        case 2:
          return selectedSavedSourceIds.length > 0 || csvUploadTags.length > 0
        case 3:
          return selectedTags.length > 0 && !hasInvalidTags
        case 4:
          return fetchState.status === 'done' && rawDataset.rows.length > 0
        case 5:
          // Full Phase-5 chain: raw → precleanse (5.1) → preprocess/fill (5.2).
          return (
            preprocess(
              precleanse(rawDataset, {
                crop: cropRange,
                conditional: conditionalRules,
                statistical: statisticalRules,
              }),
              fillStrategies,
            ).rows.length > 0
          )
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
      plantId,
      nodeId,
      csvUploadTags,
      selectedSavedSourceIds,
      hasInvalidTags,
      selectedTags,
      fetchState,
      rawDataset,
      cropRange,
      conditionalRules,
      statisticalRules,
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
    // Entering Phase 5 always starts on sub-step 5.1 (Preprocessing).
    if (target === 5) setProcessingSubStepAtom(1)
    setCurrentStep(target)
    setHighestUnlocked(prev => Math.max(prev, target))
  }, [
    canAdvance,
    currentStep,
    setCurrentStep,
    setHighestUnlocked,
    setProcessingSubStepAtom,
  ])

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
        password: source.password ?? '',
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
        password: source.password ?? '',
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

  const setProcessingSubStep = useCallback(
    (step: 1 | 2) => setProcessingSubStepAtom(step),
    [setProcessingSubStepAtom],
  )

  // Crop + outlier rules (5.1) change the cleansed dataset feeding fill/train,
  // so each relocks Training/Results (past step 4) and discards the prior run.
  const setCropRange = useCallback(
    (range: CropRange) => {
      setCropRangeAtom(range)
      resetTraining()
      setHighestUnlocked(prev => Math.min(prev, 4))
    },
    [setCropRangeAtom, resetTraining, setHighestUnlocked],
  )

  const setConditionalRules = useCallback(
    (update: React.SetStateAction<ConditionalRule[]>) => {
      setConditionalRulesAtom(update)
      resetTraining()
      setHighestUnlocked(prev => Math.min(prev, 4))
    },
    [setConditionalRulesAtom, resetTraining, setHighestUnlocked],
  )

  const setStatisticalRules = useCallback(
    (update: React.SetStateAction<StatisticalRule[]>) => {
      setStatisticalRulesAtom(update)
      resetTraining()
      setHighestUnlocked(prev => Math.min(prev, 4))
    },
    [setStatisticalRulesAtom, resetTraining, setHighestUnlocked],
  )

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

  // Setting/clearing a tag's constant changes the fetched dataset, so discard
  // the prior fetch + Training/Results and relock past Step 3 (re-fetch needed).
  const setTagConstant = useCallback(
    (tagName: string, value: number | null) => {
      setTagConstantsAtom(prev => {
        const next = { ...prev }
        if (value === null) delete next[tagName]
        else next[tagName] = value
        return next
      })
      setFetchState({ status: 'idle', progress: 0 })
      setRawDataset({ tags: [], rows: [] })
      resetTraining()
      setHighestUnlocked(prev => Math.min(prev, 3))
    },
    [
      setTagConstantsAtom,
      setFetchState,
      setRawDataset,
      resetTraining,
      setHighestUnlocked,
    ],
  )

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
    setProcessingSubStepAtom(1)
    setCropRangeAtom(null)
    setConditionalRulesAtom([])
    setStatisticalRulesAtom([])
    setFillStrategiesAtom({})
    setTagConstantsAtom({})
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
    setProcessingSubStepAtom,
    setCropRangeAtom,
    setConditionalRulesAtom,
    setStatisticalRulesAtom,
    setFillStrategiesAtom,
    setTagConstantsAtom,
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
    selectedSavedSourceIds,
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
    resetFetch,
    fetchTagOverride,
    setFetchTagOverride,
    processingSubStep,
    cropRange,
    conditionalRules,
    statisticalRules,
    setProcessingSubStep,
    setCropRange,
    setConditionalRules,
    setStatisticalRules,
    setFillStrategies,
    tagConstants,
    setTagConstant,
    resetPipeline,
    insertedTags,
    insertTag,
    removeInsertedTag,
  }
}
