import type { ExtractAtomValue } from 'jotai'
import type {
  dwConditionalRulesAtom,
  dwCriticalTagsAtom,
  dwCropRangeAtom,
  dwCsvFileNameAtom,
  dwCsvUploadTagsAtom,
  dwCustomDateRangeAtom,
  dwCustomIntervalAtom,
  dwDescriptionAtom,
  dwEdaWindowAtom,
  dwEditedTagsAtom,
  dwCleaningPipelinesAtom,
  dwCleaningTagsAtom,
  dwCleanedTagsAtom,
  dwExclusionsAtom,
  dwFeatureConfigsAtom,
  dwFeaturePresetAtom,
  dwFetchConfigAtom,
  dwFetchTagsAtom,
  dwHoldoutRangeAtom,
  dwInsertedTagsAtom,
  dwNameAtom,
  dwPresetRangeAtom,
  dwPresetRangeStaleAtom,
  dwRemovedTagsAtom,
  dwScalerConfigsAtom,
  dwSdtaPresetsAtom,
  dwSelectedColumnsAtom,
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

/**
 * DS-LAKE-037. The Create Dataset wizard's CONFIGURATION, as plain JSON, so an
 * interrupted session can be resumed from `DatasetDraft.wizardState`.
 *
 * Deliberately excluded (see the feature's D02): every row set
 * (`dwRawDatasetAtom`, CSV rows, the featured dataset), preview samples, fetch
 * state/progress, warm and sync states, and UI-only atoms. Rows come back by
 * re-running the Step 2 fetch with the restored configuration.
 *
 * Types are derived from the atoms themselves, so a change to an atom's value
 * type is a compile error here instead of a silently stale snapshot. Every
 * atom's value is already JSON-safe (dates are ISO strings) except
 * `dwSelectedTagKeysAtom`, a `Set`, which is carried as an array.
 */
type V<A> = ExtractAtomValue<A>

export interface WizardSnapshotValues {
  name: V<typeof dwNameAtom>
  description: V<typeof dwDescriptionAtom>
  workspaceId: V<typeof dwWorkspaceIdAtom>
  /** Source ids only - sources are re-resolved against the live list on resume. */
  sourceIds: string[]
  selectedTags: V<typeof dwSelectedTagsAtom>
  removedTags: V<typeof dwRemovedTagsAtom>
  editedTags: V<typeof dwEditedTagsAtom>
  insertedTags: V<typeof dwInsertedTagsAtom>
  csvUploadTags: V<typeof dwCsvUploadTagsAtom>
  csvFileName: V<typeof dwCsvFileNameAtom>
  tagConstants: V<typeof dwTagConstantsAtom>
  tagUnits: V<typeof dwTagUnitsAtom>
  tagUnitOverrides: V<typeof dwTagUnitOverridesAtom>
  presetRange: V<typeof dwPresetRangeAtom>
  presetRangeStale: V<typeof dwPresetRangeStaleAtom>
  fetchTags: V<typeof dwFetchTagsAtom>
  timeRange: V<typeof dwTimeRangeAtom>
  customDateRange: V<typeof dwCustomDateRangeAtom>
  customInterval: V<typeof dwCustomIntervalAtom>
  holdoutRange: V<typeof dwHoldoutRangeAtom>
  sourceFetchConfigs: V<typeof dwSourceFetchConfigsAtom>
  fetchConfig: V<typeof dwFetchConfigAtom>
  featureConfigs: V<typeof dwFeatureConfigsAtom>
  featurePreset: V<typeof dwFeaturePresetAtom>
  targetTag: V<typeof dwTargetTagAtom>
  criticalTags: V<typeof dwCriticalTagsAtom>
  sdtaPresets: V<typeof dwSdtaPresetsAtom>
  edaWindow: V<typeof dwEdaWindowAtom>
  cropRange: V<typeof dwCropRangeAtom>
  valueCrop: V<typeof dwValueCropAtom>
  valueClip: V<typeof dwValueClipAtom>
  exclusions: V<typeof dwExclusionsAtom>
  conditionalRules: V<typeof dwConditionalRulesAtom>
  statisticalRules: V<typeof dwStatisticalRulesAtom>
  cleaningPipelines: V<typeof dwCleaningPipelinesAtom>
  cleaningTags: V<typeof dwCleaningTagsAtom>
  cleanedTags: V<typeof dwCleanedTagsAtom>
  /** `dwSelectedTagKeysAtom` is a Set; carried as an array. */
  selectedTagKeys: string[]
  selectedColumns: V<typeof dwSelectedColumnsAtom>
  scalerConfigs: V<typeof dwScalerConfigsAtom>
  featureArtifactStamp: string | null
  currentStep: number
  highestUnlocked: number
}

/** Bump when a field's meaning or shape changes; old snapshots are then refused. */
export const WIZARD_SNAPSHOT_VERSION = 1

type Guard = (v: unknown) => boolean

const isString: Guard = v => typeof v === 'string'
const isNumber: Guard = v => typeof v === 'number' && Number.isFinite(v)
const isBoolean: Guard = v => typeof v === 'boolean'
const isArray: Guard = v => Array.isArray(v)
const isRecord: Guard = v =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isStringArray: Guard = v => Array.isArray(v) && v.every(isString)
const nullable =
  (g: Guard): Guard =>
  v =>
    v === null || g(v)

/**
 * One guard per field. The nested shapes (a cleaning pipeline, a feature
 * config) are not re-validated: the snapshot is written by `buildWizardSnapshot`
 * from the same typed atoms and belongs to the user who reads it back, so the
 * version number - not a deep schema - is what guards against drift.
 */
const GUARDS: Record<keyof WizardSnapshotValues, Guard> = {
  name: isString,
  description: isString,
  workspaceId: isString,
  sourceIds: isStringArray,
  selectedTags: isStringArray,
  removedTags: isStringArray,
  editedTags: isRecord,
  insertedTags: isStringArray,
  csvUploadTags: isStringArray,
  csvFileName: isString,
  tagConstants: isRecord,
  tagUnits: isRecord,
  tagUnitOverrides: isRecord,
  presetRange: isArray,
  presetRangeStale: isBoolean,
  fetchTags: nullable(isStringArray),
  timeRange: isString,
  customDateRange: nullable(isRecord),
  customInterval: nullable(isRecord),
  holdoutRange: nullable(isRecord),
  sourceFetchConfigs: isRecord,
  fetchConfig: isRecord,
  featureConfigs: isArray,
  featurePreset: nullable(isRecord),
  targetTag: nullable(isString),
  // Optional: snapshots written before critical tags existed carry no such
  // key, and refusing them would strand every in-progress draft. Normalised
  // to [] in parseWizardSnapshot.
  criticalTags: v => v === undefined || isStringArray(v),
  sdtaPresets: isArray,
  edaWindow: nullable(isRecord),
  cropRange: nullable(isRecord),
  valueCrop: isRecord,
  valueClip: isRecord,
  exclusions: isArray,
  conditionalRules: isArray,
  statisticalRules: isArray,
  cleaningPipelines: isRecord,
  cleaningTags: isStringArray,
  cleanedTags: isStringArray,
  selectedTagKeys: isStringArray,
  selectedColumns: nullable(isStringArray),
  scalerConfigs: isRecord,
  featureArtifactStamp: nullable(isString),
  currentStep: isNumber,
  highestUnlocked: isNumber,
}

export type WizardSnapshotParse =
  | { ok: true; values: WizardSnapshotValues }
  | { ok: false; reason: 'version' | 'shape'; field?: string }

/** Plain-JSON form of the values, ready for `PATCH wizardState`. */
export function buildWizardSnapshot(
  values: WizardSnapshotValues,
): Record<string, unknown> {
  return {
    ...values,
    sourceFetchConfigs: sanitizeSourceFetchConfigs(values.sourceFetchConfigs),
  }
}

/**
 * `dwSourceFetchConfigsAtom` holds a union that is not all configuration: a
 * CSV config carries the parsed ROWS, a SQL config a connection string, a REST
 * config free-form headers (a bearer token fits), an Influx config a token, and
 * even a PI config has an optional password field. None of that belongs in an
 * unencrypted Json column, so only a PI config's non-secret fields are kept.
 * Every other source is omitted, which is safe: Step 2's mount effect seeds a
 * missing entry from the live source (`configFromSource`) exactly as it does
 * for a fresh session.
 */
export function sanitizeSourceFetchConfigs(
  configs: WizardSnapshotValues['sourceFetchConfigs'],
): WizardSnapshotValues['sourceFetchConfigs'] {
  const kept: WizardSnapshotValues['sourceFetchConfigs'] = {}
  for (const [id, config] of Object.entries(configs)) {
    if (config.type !== 'pi') continue
    kept[id] = {
      type: 'pi',
      piName: config.piName,
      piServerUrl: config.piServerUrl,
      calcType: config.calcType,
      calcBasis: config.calcBasis,
      intervalTime: config.intervalTime,
    }
  }
  return kept
}

/** Puts a PI config's `userName` back from the live source (it is not stored). */
export function restoreSourceConfigs(
  configs: WizardSnapshotValues['sourceFetchConfigs'],
  sources: readonly { id: string; username: string }[],
): WizardSnapshotValues['sourceFetchConfigs'] {
  const restored: WizardSnapshotValues['sourceFetchConfigs'] = {}
  for (const [id, config] of Object.entries(configs)) {
    const username = sources.find(s => s.id === id)?.username
    restored[id] =
      config.type === 'pi' && username
        ? { ...config, userName: username }
        : config
  }
  return restored
}

/** The latest step a resume will land on. Steps 5-6 depend on server artifacts a resume rebuilds. */
export const RESUME_MAX_STEP = 4

export interface ResumePlan {
  values: WizardSnapshotValues
  step: number
  highestUnlocked: number
  /** True when the saved step was past `RESUME_MAX_STEP` and was pulled back. */
  pulledBack: boolean
}

/**
 * What to actually restore. A snapshot records the wizard's CLAIMS about
 * server artifacts - which tags were committed as cleaned, which feature
 * recipe a GOLD was built from - but a resume does not bring those artifacts
 * back (it builds a fresh BRONZE), so restoring the claims would let the UI
 * say "cleaned" about data that is not, and Step 6 would save it. Both are
 * dropped; the cleaning PIPELINES (the user's actual work) are kept so
 * re-committing is one click.
 *
 * A saved step past 4 is pulled back to 4 for the same reason: landing on
 * Step 5 or 6 would skip the step that rebuilds the feature artifact.
 */
export function planResume(
  values: WizardSnapshotValues,
  totalSteps: number,
): ResumePlan {
  const saved = clampStep(values.currentStep, totalSteps)
  const step = Math.min(saved, RESUME_MAX_STEP)
  const highestUnlocked = Math.max(
    step,
    Math.min(
      clampStep(values.highestUnlocked, totalSteps),
      RESUME_MAX_STEP + 1,
    ),
  )
  return {
    values: { ...values, cleanedTags: [], featureArtifactStamp: null },
    step,
    highestUnlocked,
    pulledBack: saved > RESUME_MAX_STEP,
  }
}

export function parseWizardSnapshot(
  json: unknown,
  version: number | null,
): WizardSnapshotParse {
  if (version !== WIZARD_SNAPSHOT_VERSION)
    return { ok: false, reason: 'version' }
  if (!isRecord(json)) return { ok: false, reason: 'shape' }
  const record = json as Record<string, unknown>
  for (const key of Object.keys(GUARDS) as (keyof WizardSnapshotValues)[]) {
    if (!GUARDS[key](record[key]))
      return { ok: false, reason: 'shape', field: key }
  }
  // Every field passed its guard above, which is the narrowing; TypeScript
  // cannot follow a loop over keys, hence the single assertion.
  const values = record as unknown as WizardSnapshotValues
  return {
    ok: true,
    values: { ...values, criticalTags: values.criticalTags ?? [] },
  }
}

/** Step to land on once rows are back; clamped so a bad value cannot strand the user. */
export function clampStep(step: number, total: number): number {
  return Math.min(Math.max(Math.trunc(step), 1), total)
}
