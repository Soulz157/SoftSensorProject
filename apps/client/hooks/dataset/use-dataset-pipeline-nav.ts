import { useCallback } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { preprocess, type FillStrategyConfig } from '@/lib/preprocessing'
import {
  precleanse,
  type ConditionalRule,
  type CropRange,
  type StatisticalRule,
} from '@/lib/precleanse'
import {
  DW_TOTAL_STEPS,
  dwCurrentStepAtom,
  dwHighestUnlockedAtom,
  dwSelectedTagsAtom,
  dwRemovedTagsAtom,
  dwEditedTagsAtom,
  dwHasInvalidTagsAtom,
  dwInsertedTagsAtom,
  dwTagConstantsAtom,
  dwFetchTagsAtom,
  dwTimeRangeAtom,
  dwCustomDateRangeAtom,
  dwCustomIntervalAtom,
  dwSourceFetchConfigsAtom,
  dwFetchStateAtom,
  dwRawDatasetAtom,
  dwProcessingSubStepAtom,
  dwCropRangeAtom,
  dwConditionalRulesAtom,
  dwStatisticalRulesAtom,
  dwFillStrategiesAtom,
} from '@/store/dataset-studio'
import {
  mpSelectedSavedSourceIdAtom,
  mpSelectedSavedSourceIdsAtom,
  mpTagInputMethodAtom,
  mpTagListAtom,
  type CustomInterval,
  type DataSourceConfig,
  type FetchPeriod,
  type TagInputMethod,
} from '@/store/model-pipeline'
import type { CustomDateRange, SavedDataSource } from '@/store/data-visualize'

export interface UseDatasetPipelineNavResult {
  currentStep: number
  highestUnlocked: number
  selectedTags: string[]
  removedTags: string[]
  editedTags: Record<string, string>
  hasInvalidTags: boolean
  timeRange: FetchPeriod
  customDateRange: CustomDateRange | null
  customInterval: CustomInterval | null
  sourceFetchConfigs: Record<string, DataSourceConfig>
  cropRange: CropRange
  conditionalRules: ConditionalRule[]
  statisticalRules: StatisticalRule[]
  selectedSavedSourceId: string
  selectedSavedSourceIds: string[]
  tagInputMethod: TagInputMethod
  setTagInputMethod: (method: TagInputMethod) => void
  // setSelectedSavedSource: (source: SavedDataSource) => void
  // setValidationSource: (source: SavedDataSource) => void
  // clearValidationSource: () => void
  goTo: (step: number) => void
  next: () => void
  back: () => void
  canAdvance: (step: number) => boolean
  setSelectedTags: (tags: string[]) => void
  setEditedTag: (original: string, corrected: string) => void
  removeTag: (original: string) => void
  setHasInvalidTags: (value: boolean) => void
  insertedTags: string[]
  insertTag: (tag: string) => void
  removeInsertedTag: (tag: string) => void
  tagConstants: Record<string, number>
  setTagConstant: (tagName: string, value: number | null) => void
  setTimeRange: (range: FetchPeriod) => void
  setCustomRange: (from: string, to: string) => void
  clearCustomRange: () => void
  setCustomInterval: (interval: CustomInterval | null) => void
  setSourceFetchConfigs: (
    update: React.SetStateAction<Record<string, DataSourceConfig>>,
  ) => void
  fetchTag: string[] | null
  setFetchTag: (tags: string[] | null) => void
  resetFetch: () => void
  setCropRange: (range: CropRange) => void
  processingSubStep: 1 | 2
  setProcessingSubStep: (step: 1 | 2) => void
  setConditionalRules: (update: React.SetStateAction<ConditionalRule[]>) => void
  setStatisticalRules: (update: React.SetStateAction<StatisticalRule[]>) => void
  setFillStrategies: (
    update: React.SetStateAction<Record<string, FillStrategyConfig>>,
  ) => void
}

export function useDatasetPipelineNav(): UseDatasetPipelineNavResult {
  const [currentStep, setCurrentStep] = useAtom(dwCurrentStepAtom)
  const [highestUnlocked, setHighestUnlocked] = useAtom(dwHighestUnlockedAtom)

  const [selectedSavedSourceId, setSelectedSavedSourceId] = useAtom(
    mpSelectedSavedSourceIdAtom,
  )

  const selectedSavedSourceIds = useAtomValue(mpSelectedSavedSourceIdsAtom)
  const [tagInputMethod, setTagInputMethodAtom] = useAtom(mpTagInputMethodAtom)
  const setTagListAtom = useSetAtom(mpTagListAtom)
  const [selectedTags, setSelectedTagsAtom] = useAtom(dwSelectedTagsAtom)
  const [removedTags, setRemovedTagsAtom] = useAtom(dwRemovedTagsAtom)
  const [editedTags, setEditedTagsAtom] = useAtom(dwEditedTagsAtom)
  const [hasInvalidTags, setHasInvalidTagsAtom] = useAtom(dwHasInvalidTagsAtom)
  const [insertedTags, setInsertedTagsAtom] = useAtom(dwInsertedTagsAtom)
  const [tagConstants, setTagConstantsAtom] = useAtom(dwTagConstantsAtom)
  const [fetchTag, setFetchTagAtom] = useAtom(dwFetchTagsAtom)

  const [timeRange, setTimeRangeAtom] = useAtom(dwTimeRangeAtom)
  const [customDateRange, setCustomDateRangeAtom] = useAtom(
    dwCustomDateRangeAtom,
  )
  const [customInterval, setCustomIntervalAtom] = useAtom(dwCustomIntervalAtom)
  const [sourceFetchConfigs, setSourceFetchConfigsAtom] = useAtom(
    dwSourceFetchConfigsAtom,
  )
  const fetchState = useAtomValue(dwFetchStateAtom)
  const setFetchState = useSetAtom(dwFetchStateAtom)
  const rawDataset = useAtomValue(dwRawDatasetAtom)
  const setRawDataset = useSetAtom(dwRawDatasetAtom)

  const [processingSubStep, setProcessingSubStepAtom] = useAtom(
    dwProcessingSubStepAtom,
  )

  const [cropRange, setCropRangeAtom] = useAtom(dwCropRangeAtom)
  const [conditionalRules, setConditionalRulesAtom] = useAtom(
    dwConditionalRulesAtom,
  )
  const [statisticalRules, setStatisticalRulesAtom] = useAtom(
    dwStatisticalRulesAtom,
  )
  const [fillStrategies, setFillStrategiesAtom] = useAtom(dwFillStrategiesAtom)

  const canAdvance = useCallback(
    (step: number): boolean => {
      switch (step) {
        // Step 1 — Verified Tags: at least one selected tag, none invalid.
        case 1:
          return selectedTags.length > 0 && !hasInvalidTags
        // Step 2 — Fetch Data: gate on a completed fetch with rows, not on
        // upstream source atoms (which aren't seeded on wizard entry).
        case 2:
          return fetchState.status === 'done' && rawDataset.rows.length > 0
        // Step 3 — Preprocessing: pre-cleansed dataset keeps at least one row.
        case 3:
          return (
            precleanse(rawDataset, {
              crop: cropRange,
              conditional: conditionalRules,
              statistical: statisticalRules,
            }).rows.length > 0
          )
        // Step 4 — Data Cleaning: imputed dataset keeps at least one row.
        case 4:
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
        // Step 5 — Review & Save: final step, no further Next.
        case 5:
          return false
        default:
          return false
      }
    },
    [
      selectedTags,
      hasInvalidTags,
      fetchState,
      rawDataset,
      cropRange,
      conditionalRules,
      statisticalRules,
      fillStrategies,
    ],
  )

  const goTo = useCallback(
    (step: number) => {
      if (step < 1 || step > DW_TOTAL_STEPS) return
      if (step > highestUnlocked) return
      setCurrentStep(step)
    },
    [highestUnlocked, setCurrentStep],
  )

  const next = useCallback(() => {
    if (!canAdvance(currentStep)) return
    const target = Math.min(currentStep + 1, DW_TOTAL_STEPS)
    setCurrentStep(target)
    setHighestUnlocked(prev => Math.max(prev, target))
  }, [canAdvance, currentStep, setCurrentStep, setHighestUnlocked])

  const back = useCallback(() => {
    setCurrentStep(prev => Math.max(1, prev - 1))
  }, [setCurrentStep])

  // Exposed publicly now — was a private helper only. Clears fetch state +
  // raw dataset so downstream steps recompute against a fresh fetch.
  const resetFetch = useCallback(() => {
    setFetchState({ status: 'idle', progress: 0 })
    setRawDataset({ tags: [], rows: [] })
    setHighestUnlocked(prev => Math.min(prev, 2))
  }, [setFetchState, setRawDataset, setHighestUnlocked])

  const setFetchTag = useCallback(
    (tags: string[] | null) => {
      setFetchTagAtom(tags)
      setFetchState({ status: 'idle', progress: 0 })
      setRawDataset({ tags: [], rows: [] })
      resetFetch()
      setHighestUnlocked(prev => Math.min(prev, 2))
    },
    [
      setFetchTagAtom,
      resetFetch,
      setHighestUnlocked,
      setFetchState,
      setRawDataset,
    ],
  )

  // Re-added — switches CSV upload vs Saved Source input mode. Ported from the
  // old useModelPipelineNav.setTagInputMethod reset chain, minus the
  // Training/Results reset (out of scope for this hook). Relock target
  // adjusted to step 1 to match this hook's numbering (step 1 = tag
  // selection is the earliest step here).
  const setTagInputMethod = useCallback(
    (method: TagInputMethod) => {
      setTagInputMethodAtom(method)
      setSelectedSavedSourceId('')
      setTagListAtom([])
      setSelectedTagsAtom([])
      setEditedTagsAtom({})
      setRemovedTagsAtom([])
      setInsertedTagsAtom([])
      setHasInvalidTagsAtom(false)
      resetFetch()
      setFillStrategiesAtom({})
      setHighestUnlocked(prev => Math.min(prev, 1))
    },
    [
      setTagInputMethodAtom,
      setSelectedSavedSourceId,
      setTagListAtom,
      setSelectedTagsAtom,
      setEditedTagsAtom,
      setRemovedTagsAtom,
      setInsertedTagsAtom,
      setHasInvalidTagsAtom,
      resetFetch,
      setFillStrategiesAtom,
      setHighestUnlocked,
    ],
  )

  const setSelectedTags = useCallback(
    (tags: string[]) => {
      setSelectedTagsAtom(tags)
      resetFetch()
      setFillStrategiesAtom(
        prev =>
          Object.fromEntries(
            Object.entries(prev).filter(([tag]) => tags.includes(tag)),
          ) as Record<string, FillStrategyConfig>,
      )
      setHighestUnlocked(prev => Math.min(prev, 1))
    },
    [
      setSelectedTagsAtom,
      resetFetch,
      setFillStrategiesAtom,
      setHighestUnlocked,
    ],
  )

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
    (value: boolean) => setHasInvalidTagsAtom(value),
    [setHasInvalidTagsAtom],
  )

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

  const setTagConstant = useCallback(
    (tagName: string, value: number | null) => {
      setTagConstantsAtom(prev => {
        const next = { ...prev }
        if (value === null) delete next[tagName]
        else next[tagName] = value
        return next
      })
      resetFetch()
      setHighestUnlocked(prev => Math.min(prev, 2))
    },
    [setTagConstantsAtom, resetFetch, setHighestUnlocked],
  )

  const setTimeRange = useCallback(
    (range: FetchPeriod) => {
      setTimeRangeAtom(range)
      setCustomDateRangeAtom(null)
      resetFetch()
      setHighestUnlocked(prev => Math.min(prev, 2))
    },
    [setTimeRangeAtom, setCustomDateRangeAtom, resetFetch, setHighestUnlocked],
  )

  const setCustomRange = useCallback(
    (from: string, to: string) => {
      setCustomDateRangeAtom({ from, to })
      resetFetch()
      setHighestUnlocked(prev => Math.min(prev, 2))
    },
    [setCustomDateRangeAtom, resetFetch, setHighestUnlocked],
  )

  // Re-added — mirrors setCustomRange but clears the range instead of setting
  // one. Same downstream reset + relock target (step 2).
  const clearCustomRange = useCallback(() => {
    setCustomDateRangeAtom(null)
    resetFetch()
    setHighestUnlocked(prev => Math.min(prev, 2))
  }, [setCustomDateRangeAtom, resetFetch, setHighestUnlocked])

  const setCustomInterval = useCallback(
    (interval: CustomInterval | null) => {
      setCustomIntervalAtom(interval)
      resetFetch()
      setHighestUnlocked(prev => Math.min(prev, 2))
    },
    [setCustomIntervalAtom, resetFetch, setHighestUnlocked],
  )

  const setSourceFetchConfigs = useCallback(
    (update: React.SetStateAction<Record<string, DataSourceConfig>>) => {
      setSourceFetchConfigsAtom(update)
      resetFetch()
      setHighestUnlocked(prev => Math.min(prev, 2))
    },
    [setSourceFetchConfigsAtom, resetFetch, setHighestUnlocked],
  )

  const setCropRange = useCallback(
    (range: CropRange) => {
      setCropRangeAtom(range)
      setHighestUnlocked(prev => Math.min(prev, 3))
    },
    [setCropRangeAtom, setHighestUnlocked],
  )

  const setProcessingSubStep = useCallback(
    (step: 1 | 2) => setProcessingSubStepAtom(step),
    [setProcessingSubStepAtom],
  )

  const setConditionalRules = useCallback(
    (update: React.SetStateAction<ConditionalRule[]>) => {
      setConditionalRulesAtom(update)
      setHighestUnlocked(prev => Math.min(prev, 3))
    },
    [setConditionalRulesAtom, setHighestUnlocked],
  )

  const setStatisticalRules = useCallback(
    (update: React.SetStateAction<StatisticalRule[]>) => {
      setStatisticalRulesAtom(update)
      setHighestUnlocked(prev => Math.min(prev, 3))
    },
    [setStatisticalRulesAtom, setHighestUnlocked],
  )

  const setFillStrategies = useCallback(
    (update: React.SetStateAction<Record<string, FillStrategyConfig>>) => {
      setFillStrategiesAtom(update)
      setHighestUnlocked(prev => Math.min(prev, 4))
    },
    [setFillStrategiesAtom, setHighestUnlocked],
  )

  return {
    currentStep,
    highestUnlocked,
    selectedTags,
    removedTags,
    editedTags,
    hasInvalidTags,
    timeRange,
    customDateRange,
    customInterval,
    sourceFetchConfigs,
    cropRange,
    conditionalRules,
    statisticalRules,
    selectedSavedSourceId,
    selectedSavedSourceIds,
    tagInputMethod,
    setTagInputMethod,
    goTo,
    next,
    back,
    canAdvance,
    setSelectedTags,
    setEditedTag,
    removeTag,
    setHasInvalidTags,
    insertedTags,
    insertTag,
    removeInsertedTag,
    tagConstants,
    setTagConstant,
    fetchTag,
    setFetchTag,
    resetFetch,
    setTimeRange,
    setCustomRange,
    clearCustomRange,
    setCustomInterval,
    setSourceFetchConfigs,
    setCropRange,
    setConditionalRules,
    setStatisticalRules,
    setFillStrategies,
    processingSubStep,
    setProcessingSubStep,
  }
}
