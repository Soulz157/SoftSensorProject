import type { Atom, createStore } from 'jotai'
import type { SavedDataSource } from '@/lib/mock-data-sources'
import type { WizardSnapshotValues } from '@/lib/dataset-wizard-snapshot'
import {
  dwCleanedTagsAtom,
  dwCleaningPipelinesAtom,
  dwCleaningTagsAtom,
  dwConditionalRulesAtom,
  dwCropRangeAtom,
  dwCsvFileNameAtom,
  dwCsvUploadTagsAtom,
  dwCurrentStepAtom,
  dwCustomDateRangeAtom,
  dwCustomIntervalAtom,
  dwDescriptionAtom,
  dwEdaWindowAtom,
  dwEditedTagsAtom,
  dwExclusionsAtom,
  dwFeatureArtifactStampAtom,
  dwFeatureConfigsAtom,
  dwFeaturePresetAtom,
  dwFetchConfigAtom,
  dwFetchTagsAtom,
  dwHighestUnlockedAtom,
  dwHoldoutRangeAtom,
  dwInsertedTagsAtom,
  dwNameAtom,
  dwPresetRangeAtom,
  dwPresetRangeStaleAtom,
  dwRemovedTagsAtom,
  dwScalerConfigsAtom,
  dwSdtaPresetsAtom,
  dwSelectedColumnsAtom,
  dwSelectedSourcesAtom,
  dwSelectedTagKeysAtom,
  dwSelectedTagsAtom,
  dwSourceFetchConfigsAtom,
  dwStatisticalRulesAtom,
  dwTagConstantsAtom,
  dwTagUnitOverridesAtom,
  dwTagUnitsAtom,
  dwTargetTagAtom,
  dwTimeRangeAtom,
  dwValueClipAtom,
  dwValueCropAtom,
  dwWorkspaceIdAtom,
} from '@/store/dataset-studio'

type Store = ReturnType<typeof createStore>

/**
 * DS-LAKE-037. The ONE place that maps `WizardSnapshotValues` to the `dw*`
 * atoms, in both directions. Reads and writes go through the jotai store with
 * the atoms' own setters - never through `useDatasetPipelineNav`'s, which
 * relock `highestUnlocked` and reset downstream state - so hydrating a resumed
 * wizard cannot trip those side effects.
 */

/** Every atom a snapshot reads; the sync hook subscribes to exactly these. */
export const SNAPSHOT_ATOMS: readonly Atom<unknown>[] = [
  dwNameAtom,
  dwDescriptionAtom,
  dwWorkspaceIdAtom,
  dwSelectedSourcesAtom,
  dwSelectedTagsAtom,
  dwRemovedTagsAtom,
  dwEditedTagsAtom,
  dwInsertedTagsAtom,
  dwCsvUploadTagsAtom,
  dwCsvFileNameAtom,
  dwTagConstantsAtom,
  dwTagUnitsAtom,
  dwTagUnitOverridesAtom,
  dwPresetRangeAtom,
  dwPresetRangeStaleAtom,
  dwFetchTagsAtom,
  dwTimeRangeAtom,
  dwCustomDateRangeAtom,
  dwCustomIntervalAtom,
  dwHoldoutRangeAtom,
  dwSourceFetchConfigsAtom,
  dwFetchConfigAtom,
  dwFeatureConfigsAtom,
  dwFeaturePresetAtom,
  dwTargetTagAtom,
  dwSdtaPresetsAtom,
  dwEdaWindowAtom,
  dwCropRangeAtom,
  dwValueCropAtom,
  dwValueClipAtom,
  dwExclusionsAtom,
  dwConditionalRulesAtom,
  dwStatisticalRulesAtom,
  dwCleaningPipelinesAtom,
  dwCleaningTagsAtom,
  dwCleanedTagsAtom,
  dwSelectedTagKeysAtom,
  dwSelectedColumnsAtom,
  dwScalerConfigsAtom,
  dwFeatureArtifactStampAtom,
  dwCurrentStepAtom,
  dwHighestUnlockedAtom,
]

export function readWizardSnapshotValues(store: Store): WizardSnapshotValues {
  return {
    name: store.get(dwNameAtom),
    description: store.get(dwDescriptionAtom),
    workspaceId: store.get(dwWorkspaceIdAtom),
    sourceIds: store.get(dwSelectedSourcesAtom).map(s => s.id),
    selectedTags: store.get(dwSelectedTagsAtom),
    removedTags: store.get(dwRemovedTagsAtom),
    editedTags: store.get(dwEditedTagsAtom),
    insertedTags: store.get(dwInsertedTagsAtom),
    csvUploadTags: store.get(dwCsvUploadTagsAtom),
    csvFileName: store.get(dwCsvFileNameAtom),
    tagConstants: store.get(dwTagConstantsAtom),
    tagUnits: store.get(dwTagUnitsAtom),
    tagUnitOverrides: store.get(dwTagUnitOverridesAtom),
    presetRange: store.get(dwPresetRangeAtom),
    presetRangeStale: store.get(dwPresetRangeStaleAtom),
    fetchTags: store.get(dwFetchTagsAtom),
    timeRange: store.get(dwTimeRangeAtom),
    customDateRange: store.get(dwCustomDateRangeAtom),
    customInterval: store.get(dwCustomIntervalAtom),
    holdoutRange: store.get(dwHoldoutRangeAtom),
    sourceFetchConfigs: store.get(dwSourceFetchConfigsAtom),
    fetchConfig: store.get(dwFetchConfigAtom),
    featureConfigs: store.get(dwFeatureConfigsAtom),
    featurePreset: store.get(dwFeaturePresetAtom),
    targetTag: store.get(dwTargetTagAtom),
    sdtaPresets: store.get(dwSdtaPresetsAtom),
    edaWindow: store.get(dwEdaWindowAtom),
    cropRange: store.get(dwCropRangeAtom),
    valueCrop: store.get(dwValueCropAtom),
    valueClip: store.get(dwValueClipAtom),
    exclusions: store.get(dwExclusionsAtom),
    conditionalRules: store.get(dwConditionalRulesAtom),
    statisticalRules: store.get(dwStatisticalRulesAtom),
    cleaningPipelines: store.get(dwCleaningPipelinesAtom),
    cleaningTags: store.get(dwCleaningTagsAtom),
    cleanedTags: store.get(dwCleanedTagsAtom),
    selectedTagKeys: [...store.get(dwSelectedTagKeysAtom)],
    selectedColumns: store.get(dwSelectedColumnsAtom),
    scalerConfigs: store.get(dwScalerConfigsAtom),
    featureArtifactStamp: store.get(dwFeatureArtifactStampAtom),
    currentStep: store.get(dwCurrentStepAtom),
    highestUnlocked: store.get(dwHighestUnlockedAtom),
  }
}

/**
 * `sources` are the live `SavedDataSource`s resolved from `values.sourceIds` -
 * a snapshot stores ids only, so credentials-adjacent fields never leave the
 * source list the user already has.
 */
export function writeWizardSnapshotValues(
  store: Store,
  values: WizardSnapshotValues,
  sources: SavedDataSource[],
): void {
  store.set(dwNameAtom, values.name)
  store.set(dwDescriptionAtom, values.description)
  store.set(dwWorkspaceIdAtom, values.workspaceId)
  store.set(dwSelectedSourcesAtom, sources)
  store.set(dwSelectedTagsAtom, values.selectedTags)
  store.set(dwRemovedTagsAtom, values.removedTags)
  store.set(dwEditedTagsAtom, values.editedTags)
  store.set(dwInsertedTagsAtom, values.insertedTags)
  store.set(dwCsvUploadTagsAtom, values.csvUploadTags)
  store.set(dwCsvFileNameAtom, values.csvFileName)
  store.set(dwTagConstantsAtom, values.tagConstants)
  store.set(dwTagUnitsAtom, values.tagUnits)
  store.set(dwTagUnitOverridesAtom, values.tagUnitOverrides)
  store.set(dwPresetRangeAtom, values.presetRange)
  store.set(dwPresetRangeStaleAtom, values.presetRangeStale)
  store.set(dwFetchTagsAtom, values.fetchTags)
  store.set(dwTimeRangeAtom, values.timeRange)
  store.set(dwCustomDateRangeAtom, values.customDateRange)
  store.set(dwCustomIntervalAtom, values.customInterval)
  store.set(dwHoldoutRangeAtom, values.holdoutRange)
  store.set(dwSourceFetchConfigsAtom, values.sourceFetchConfigs)
  store.set(dwFetchConfigAtom, values.fetchConfig)
  store.set(dwFeatureConfigsAtom, values.featureConfigs)
  store.set(dwFeaturePresetAtom, values.featurePreset)
  store.set(dwTargetTagAtom, values.targetTag)
  store.set(dwSdtaPresetsAtom, values.sdtaPresets)
  store.set(dwEdaWindowAtom, values.edaWindow)
  store.set(dwCropRangeAtom, values.cropRange)
  store.set(dwValueCropAtom, values.valueCrop)
  store.set(dwValueClipAtom, values.valueClip)
  store.set(dwExclusionsAtom, values.exclusions)
  store.set(dwConditionalRulesAtom, values.conditionalRules)
  store.set(dwStatisticalRulesAtom, values.statisticalRules)
  store.set(dwCleaningPipelinesAtom, values.cleaningPipelines)
  store.set(dwCleaningTagsAtom, values.cleaningTags)
  store.set(dwCleanedTagsAtom, values.cleanedTags)
  store.set(dwSelectedTagKeysAtom, new Set(values.selectedTagKeys))
  store.set(dwSelectedColumnsAtom, values.selectedColumns)
  store.set(dwScalerConfigsAtom, values.scalerConfigs)
  store.set(dwFeatureArtifactStampAtom, values.featureArtifactStamp)
  store.set(dwCurrentStepAtom, values.currentStep)
  store.set(dwHighestUnlockedAtom, values.highestUnlocked)
}
