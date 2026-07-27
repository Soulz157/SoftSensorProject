import { useCallback, useRef } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  preprocessPipelines,
  type ScalerMethod,
  type TagPipeline,
} from '@/lib/preprocessing'
import {
  applyFeatures,
  selectColumns,
  type FeatureConfig,
} from '@/lib/feature-engineering'
import {
  precleanse,
  type ConditionalRule,
  type CropRange,
  type RangeExclusion,
  type StatisticalRule,
  type ValueCrop,
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
  dwValueCropAtom,
  dwExclusionsAtom,
  dwConditionalRulesAtom,
  dwStatisticalRulesAtom,
  dwCleaningPipelinesAtom,
  dwCleaningTagsAtom,
  dwCleanedTagsAtom,
  dwFeatureConfigsAtom,
  dwSelectedColumnsAtom,
  dwScalerConfigsAtom,
  dwHiddenTagsAtom,
  dwFocusedTagAtom,
  dwModeAtom,
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
import type { CustomDateRange } from '@/store/data-visualize'

export interface UseDatasetPipelineNavResult {
  /** True in edit mode — the raw query (tags/time range/features) is locked;
      only the Step-3 preprocessing pipeline may change. */
  isEditLocked: boolean
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
  valueCrop: ValueCrop
  exclusions: RangeExclusion[]
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
  setValueCrop: (crop: ValueCrop) => void
  setExclusions: (exclusions: RangeExclusion[]) => void
  processingSubStep: 1 | 2
  setProcessingSubStep: (step: 1 | 2) => void
  setConditionalRules: (update: React.SetStateAction<ConditionalRule[]>) => void
  setStatisticalRules: (update: React.SetStateAction<StatisticalRule[]>) => void
  // Step 3.2 — bulk cleaning
  cleaningTags: string[]
  setCleaningTags: (tags: string[]) => void
  cleaningPipelines: Record<string, TagPipeline>
  setCleaningPipelines: (
    update: React.SetStateAction<Record<string, TagPipeline>>,
  ) => void
  // Tags whose pipeline has been saved (Cleaned). Additive commit point.
  cleanedTags: string[]
  // Commit one pipeline to a whole batch of tags and mark them Cleaned. Merges
  // into the per-tag pipelines map (never wipes tags outside the batch).
  saveCleanedTags: (tags: string[], pipeline: TagPipeline) => void
  // Step 4 — Feature Engineering
  featureConfigs: FeatureConfig[]
  setFeatureConfigs: (update: React.SetStateAction<FeatureConfig[]>) => void
  selectedColumns: string[] | null
  setSelectedColumns: (columns: string[] | null) => void
  scalerConfigs: Record<string, ScalerMethod>
  setScalerConfig: (column: string, method: ScalerMethod) => void
}

export function useDatasetPipelineNav(): UseDatasetPipelineNavResult {
  const mode = useAtomValue(dwModeAtom)
  const isEditLocked = mode === 'edit'
  // Stable ref so the schema-lock guard can live inside memoized setters
  // without adding `isEditLocked` to every dependency array.
  const lockedRef = useRef(isEditLocked)
  lockedRef.current = isEditLocked

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
  const [valueCrop, setValueCropAtom] = useAtom(dwValueCropAtom)
  const [exclusions, setExclusionsAtom] = useAtom(dwExclusionsAtom)
  const [conditionalRules, setConditionalRulesAtom] = useAtom(
    dwConditionalRulesAtom,
  )
  const [statisticalRules, setStatisticalRulesAtom] = useAtom(
    dwStatisticalRulesAtom,
  )
  const [cleaningPipelines, setCleaningPipelinesAtom] = useAtom(
    dwCleaningPipelinesAtom,
  )
  const [cleaningTags, setCleaningTagsAtom] = useAtom(dwCleaningTagsAtom)
  const [cleanedTags, setCleanedTagsAtom] = useAtom(dwCleanedTagsAtom)
  const setHiddenTagsAtom = useSetAtom(dwHiddenTagsAtom)
  const setFocusedTagAtom = useSetAtom(dwFocusedTagAtom)
  const [featureConfigs, setFeatureConfigsAtom] = useAtom(dwFeatureConfigsAtom)
  const [selectedColumns, setSelectedColumnsAtom] = useAtom(
    dwSelectedColumnsAtom,
  )
  const [scalerConfigs, setScalerConfigsAtom] = useAtom(dwScalerConfigsAtom)

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
              valueCrop,
              exclusions,
              conditional: conditionalRules,
              statistical: statisticalRules,
            }).rows.length > 0
          )
        // Step 4 — Feature Engineering: the fully-materialized dataset
        // (features → precleanse → fill → select) keeps at least one row/column.
        case 4: {
          const featured = applyFeatures(rawDataset, featureConfigs)
          const filled = preprocessPipelines(
            precleanse(featured, {
              crop: cropRange,
              valueCrop,
              exclusions,
              conditional: conditionalRules,
              statistical: statisticalRules,
            }),
            cleaningPipelines,
          )
          const selected = selectColumns(filled, selectedColumns)
          return selected.rows.length > 0 && selected.tags.length > 0
        }
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
      valueCrop,
      exclusions,
      conditionalRules,
      statisticalRules,
      cleaningPipelines,
      featureConfigs,
      selectedColumns,
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
      if (lockedRef.current) return
      setTagInputMethodAtom(method)
      setSelectedSavedSourceId('')
      setTagListAtom([])
      setSelectedTagsAtom([])
      setEditedTagsAtom({})
      setRemovedTagsAtom([])
      setInsertedTagsAtom([])
      setHasInvalidTagsAtom(false)
      resetFetch()
      setCleaningPipelinesAtom({})
      setCleaningTagsAtom([])
      setCleanedTagsAtom([])
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
      setCleaningPipelinesAtom,
      setCleaningTagsAtom,
      setCleanedTagsAtom,
      setHighestUnlocked,
    ],
  )

  const setSelectedTags = useCallback(
    (tags: string[]) => {
      if (lockedRef.current) return
      setSelectedTagsAtom(tags)
      resetFetch()
      // Prune the cleaning pipelines + cleaning-target set to surviving tags.
      setCleaningPipelinesAtom(prev =>
        Object.fromEntries(
          Object.entries(prev).filter(([tag]) => tags.includes(tag)),
        ),
      )
      setCleaningTagsAtom(prev => prev.filter(t => tags.includes(t)))
      // A tag dropped from the dataset can no longer be Cleaned.
      setCleanedTagsAtom(prev => prev.filter(t => tags.includes(t)))
      // Prune shared analysis selection to the new tag set (visibility state).
      setHiddenTagsAtom(prev => prev.filter(t => tags.includes(t)))
      setFocusedTagAtom(prev => (tags.includes(prev) ? prev : ''))
      setHighestUnlocked(prev => Math.min(prev, 1))
    },
    [
      setSelectedTagsAtom,
      resetFetch,
      setCleaningPipelinesAtom,
      setCleaningTagsAtom,
      setCleanedTagsAtom,
      setHiddenTagsAtom,
      setFocusedTagAtom,
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
      if (lockedRef.current) return
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
      if (lockedRef.current) return
      setTimeRangeAtom(range)
      setCustomDateRangeAtom(null)
      resetFetch()
      setHighestUnlocked(prev => Math.min(prev, 2))
    },
    [setTimeRangeAtom, setCustomDateRangeAtom, resetFetch, setHighestUnlocked],
  )

  const setCustomRange = useCallback(
    (from: string, to: string) => {
      if (lockedRef.current) return
      setCustomDateRangeAtom({ from, to })
      resetFetch()
      setHighestUnlocked(prev => Math.min(prev, 2))
    },
    [setCustomDateRangeAtom, resetFetch, setHighestUnlocked],
  )

  // Re-added — mirrors setCustomRange but clears the range instead of setting
  // one. Same downstream reset + relock target (step 2).
  const clearCustomRange = useCallback(() => {
    if (lockedRef.current) return
    setCustomDateRangeAtom(null)
    resetFetch()
    setHighestUnlocked(prev => Math.min(prev, 2))
  }, [setCustomDateRangeAtom, resetFetch, setHighestUnlocked])

  const setCustomInterval = useCallback(
    (interval: CustomInterval | null) => {
      if (lockedRef.current) return
      setCustomIntervalAtom(interval)
      resetFetch()
      setHighestUnlocked(prev => Math.min(prev, 2))
    },
    [setCustomIntervalAtom, resetFetch, setHighestUnlocked],
  )

  const setSourceFetchConfigs = useCallback(
    (update: React.SetStateAction<Record<string, DataSourceConfig>>) => {
      if (lockedRef.current) return
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

  const setValueCrop = useCallback(
    (crop: ValueCrop) => {
      setValueCropAtom(crop)
      setHighestUnlocked(prev => Math.min(prev, 3))
    },
    [setValueCropAtom, setHighestUnlocked],
  )

  const setExclusions = useCallback(
    (next: RangeExclusion[]) => {
      setExclusionsAtom(next)
      setHighestUnlocked(prev => Math.min(prev, 3))
    },
    [setExclusionsAtom, setHighestUnlocked],
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

  const setCleaningPipelines = useCallback(
    (update: React.SetStateAction<Record<string, TagPipeline>>) => {
      setCleaningPipelinesAtom(update)
      setHighestUnlocked(prev => Math.min(prev, 4))
    },
    [setCleaningPipelinesAtom, setHighestUnlocked],
  )

  const setCleaningTags = useCallback(
    (tags: string[]) => {
      setCleaningTagsAtom(tags)
      setHighestUnlocked(prev => Math.min(prev, 4))
    },
    [setCleaningTagsAtom, setHighestUnlocked],
  )

  // Save = the commit point. Write one shared pipeline to every tag in the
  // batch (merge — never rebuild the map, so other tags' saved pipelines
  // survive) and union the batch into the Cleaned set.
  const saveCleanedTags = useCallback(
    (tags: string[], pipeline: TagPipeline) => {
      setCleaningPipelinesAtom(prev => {
        const next = { ...prev }
        for (const tag of tags) next[tag] = pipeline
        return next
      })
      setCleanedTagsAtom(prev => Array.from(new Set([...prev, ...tags])))
      setHighestUnlocked(prev => Math.min(prev, 4))
    },
    [setCleaningPipelinesAtom, setCleanedTagsAtom, setHighestUnlocked],
  )

  const setFeatureConfigs = useCallback(
    (update: React.SetStateAction<FeatureConfig[]>) => {
      if (lockedRef.current) return
      setFeatureConfigsAtom(update)
      setHighestUnlocked(prev => Math.min(prev, 4))
    },
    [setFeatureConfigsAtom, setHighestUnlocked],
  )

  const setSelectedColumns = useCallback(
    (columns: string[] | null) => {
      if (lockedRef.current) return
      setSelectedColumnsAtom(columns)
      setHighestUnlocked(prev => Math.min(prev, 4))
    },
    [setSelectedColumnsAtom, setHighestUnlocked],
  )

  const setScalerConfig = useCallback(
    (column: string, method: ScalerMethod) => {
      if (lockedRef.current) return
      setScalerConfigsAtom(prev => ({ ...prev, [column]: method }))
      setHighestUnlocked(prev => Math.min(prev, 4))
    },
    [setScalerConfigsAtom, setHighestUnlocked],
  )

  return {
    isEditLocked,
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
    valueCrop,
    exclusions,
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
    setValueCrop,
    setExclusions,
    setConditionalRules,
    setStatisticalRules,
    cleaningTags,
    setCleaningTags,
    cleaningPipelines,
    setCleaningPipelines,
    cleanedTags,
    saveCleanedTags,
    featureConfigs,
    setFeatureConfigs,
    selectedColumns,
    setSelectedColumns,
    scalerConfigs,
    setScalerConfig,
    processingSubStep,
    setProcessingSubStep,
  }
}
