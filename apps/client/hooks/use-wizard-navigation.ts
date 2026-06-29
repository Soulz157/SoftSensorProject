import { useCallback } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { type TimeRange } from '@/lib/mock-readings'
import { preprocess, type FillStrategyConfig } from '@/lib/preprocessing'
import {
  TOTAL_WIZARD_STEPS,
  currentStepAtom,
  highestUnlockedAtom,
  workspaceIdAtom,
  plantIdAtom,
  dataSourceAtom,
  dataSourceCredentialsAtom,
  customDateRangeAtom,
  piServerIdAtom,
  tagListAtom,
  selectedTagsAtom,
  timeRangeAtom,
  fetchStateAtom,
  rawDatasetAtom,
  fillStrategiesAtom,
  selectedModelIdAtom,
  selectedSavedSourceIdAtom,
  type CustomDateRange,
} from '@/store/data-visualize'

const EMPTY_DEFAULT_RANGE: TimeRange = '24h'

export interface UseWizardNavigationResult {
  currentStep: number
  highestUnlocked: number
  customDateRange: CustomDateRange | null
  selectedSavedSourceId: string
  goTo: (step: number) => void
  next: () => void
  back: () => void
  canAdvance: (step: number) => boolean
  setWorkspaceId: (id: string) => void
  setPlantId: (id: string) => void
  setSelectedTags: (tags: string[]) => void
  setTimeRange: (range: TimeRange) => void
  setCustomRange: (from: string, to: string) => void
  clearCustomRange: () => void
}

/** Owns wizard step gating + cascade invalidation on upstream selection changes. */
export function useWizardNavigation(): UseWizardNavigationResult {
  const [currentStep, setCurrentStep] = useAtom(currentStepAtom)
  const [highestUnlocked, setHighestUnlocked] = useAtom(highestUnlockedAtom)

  const setWorkspaceIdAtom = useSetAtom(workspaceIdAtom)
  const [plantId, setPlantIdAtom] = useAtom(plantIdAtom)
  const setDataSourceAtom = useSetAtom(dataSourceAtom)
  const setDataSourceCredentials = useSetAtom(dataSourceCredentialsAtom)
  const [selectedSavedSourceId, setSelectedSavedSourceId] = useAtom(
    selectedSavedSourceIdAtom,
  )
  const [customDateRange, setCustomDateRangeAtom] = useAtom(customDateRangeAtom)
  const setPiServerIdAtom = useSetAtom(piServerIdAtom)
  const setTagList = useSetAtom(tagListAtom)
  const [selectedTags, setSelectedTagsAtom] = useAtom(selectedTagsAtom)
  const setTimeRangeAtom = useSetAtom(timeRangeAtom)
  const fetchState = useAtomValue(fetchStateAtom)
  const setFetchState = useSetAtom(fetchStateAtom)
  const rawDataset = useAtomValue(rawDatasetAtom)
  const setRawDataset = useSetAtom(rawDatasetAtom)
  const [fillStrategies, setFillStrategies] = useAtom(fillStrategiesAtom)
  const selectedModelId = useAtomValue(selectedModelIdAtom)

  const canAdvance = useCallback(
    (step: number): boolean => {
      switch (step) {
        case 1:
          return plantId !== ''
        case 2:
          return selectedSavedSourceId !== ''
        case 3:
          return selectedTags.length > 0
        case 4:
          return fetchState.status === 'done' && rawDataset.rows.length > 0
        case 5:
          return true
        case 6:
          return preprocess(rawDataset, fillStrategies).rows.length > 0
        case 7:
          return selectedModelId !== ''
        default:
          return false
      }
    },
    [
      plantId,
      selectedSavedSourceId,
      selectedTags,
      fetchState,
      rawDataset,
      fillStrategies,
      selectedModelId,
    ],
  )

  const goTo = useCallback(
    (step: number) => {
      if (step < 1 || step > TOTAL_WIZARD_STEPS) return
      if (step > highestUnlocked) return
      setCurrentStep(step)
    },
    [highestUnlocked, setCurrentStep],
  )

  const next = useCallback(() => {
    if (!canAdvance(currentStep)) return
    const target = Math.min(currentStep + 1, TOTAL_WIZARD_STEPS)
    setCurrentStep(target)
    setHighestUnlocked(prev => Math.max(prev, target))
  }, [canAdvance, currentStep, setCurrentStep, setHighestUnlocked])

  const back = useCallback(() => {
    setCurrentStep(prev => Math.max(1, prev - 1))
  }, [setCurrentStep])

  const setWorkspaceId = useCallback(
    (id: string) => {
      setWorkspaceIdAtom(id)
      setPlantIdAtom('')
      setDataSourceAtom('')
      setDataSourceCredentials(null)
      setCustomDateRangeAtom(null)
      setSelectedSavedSourceId('')
      setPiServerIdAtom('')
      setTagList([])
      setSelectedTagsAtom([])
      setTimeRangeAtom(EMPTY_DEFAULT_RANGE)
      setFetchState({ status: 'idle', progress: 0 })
      setRawDataset({ tags: [], rows: [] })
      setFillStrategies({})
      setHighestUnlocked(1)
      setCurrentStep(1)
    },
    [
      setWorkspaceIdAtom,
      setPlantIdAtom,
      setDataSourceAtom,
      setDataSourceCredentials,
      setCustomDateRangeAtom,
      setSelectedSavedSourceId,
      setPiServerIdAtom,
      setTagList,
      setSelectedTagsAtom,
      setTimeRangeAtom,
      setFetchState,
      setRawDataset,
      setFillStrategies,
      setHighestUnlocked,
      setCurrentStep,
    ],
  )

  const setPlantId = useCallback(
    (id: string) => {
      setPlantIdAtom(id)
      setDataSourceAtom('')
      setDataSourceCredentials(null)
      setCustomDateRangeAtom(null)
      setSelectedSavedSourceId('')
      setPiServerIdAtom('')
      setTagList([])
      setSelectedTagsAtom([])
      setTimeRangeAtom(EMPTY_DEFAULT_RANGE)
      setFetchState({ status: 'idle', progress: 0 })
      setRawDataset({ tags: [], rows: [] })
      setFillStrategies({})
      setHighestUnlocked(prev => Math.min(prev, 2))
    },
    [
      setPlantIdAtom,
      setDataSourceAtom,
      setDataSourceCredentials,
      setCustomDateRangeAtom,
      setSelectedSavedSourceId,
      setPiServerIdAtom,
      setTagList,
      setSelectedTagsAtom,
      setTimeRangeAtom,
      setFetchState,
      setRawDataset,
      setFillStrategies,
      setHighestUnlocked,
    ],
  )

  const setSelectedTags = useCallback(
    (tags: string[]) => {
      setSelectedTagsAtom(tags)
      setFetchState({ status: 'idle', progress: 0 })
      setRawDataset({ tags: [], rows: [] })
      setFillStrategies(
        prev =>
          Object.fromEntries(
            Object.entries(prev).filter(([tag]) => tags.includes(tag)),
          ) as Record<string, FillStrategyConfig>,
      )
      setHighestUnlocked(prev => Math.min(prev, 3))
    },
    [
      setSelectedTagsAtom,
      setFetchState,
      setRawDataset,
      setFillStrategies,
      setHighestUnlocked,
    ],
  )

  const setTimeRange = useCallback(
    (range: TimeRange) => {
      setTimeRangeAtom(range)
      setCustomDateRangeAtom(null)
      setFetchState({ status: 'idle', progress: 0 })
      setRawDataset({ tags: [], rows: [] })
      setHighestUnlocked(prev => Math.min(prev, 3))
    },
    [
      setTimeRangeAtom,
      setCustomDateRangeAtom,
      setFetchState,
      setRawDataset,
      setHighestUnlocked,
    ],
  )

  const setCustomRange = useCallback(
    (from: string, to: string) => {
      setCustomDateRangeAtom({ from, to })
      setFetchState({ status: 'idle', progress: 0 })
      setRawDataset({ tags: [], rows: [] })
      setHighestUnlocked(prev => Math.min(prev, 3))
    },
    [setCustomDateRangeAtom, setFetchState, setRawDataset, setHighestUnlocked],
  )

  const clearCustomRange = useCallback(() => {
    setCustomDateRangeAtom(null)
    setFetchState({ status: 'idle', progress: 0 })
    setRawDataset({ tags: [], rows: [] })
    setHighestUnlocked(prev => Math.min(prev, 3))
  }, [setCustomDateRangeAtom, setFetchState, setRawDataset, setHighestUnlocked])

  return {
    currentStep,
    highestUnlocked,
    customDateRange,
    selectedSavedSourceId,
    goTo,
    next,
    back,
    canAdvance,
    setWorkspaceId,
    setPlantId,
    setSelectedTags,
    setTimeRange,
    setCustomRange,
    clearCustomRange,
  }
}
