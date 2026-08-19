import { describe, it, expect } from 'vitest'
import { createStore } from 'jotai'
import {
  dwFeaturePresetAtom,
  dwTargetTagAtom,
  dwSdtaConfigAtom,
  dwWorkspaceIdAtom,
  initDatasetWizardAtom,
  resetDatasetWizardAtom,
  initDatasetWizardForEditAtom,
} from '@/store/dataset-studio'
import { EMPTY_PIPELINE_CONFIG } from '@/lib/pipeline-config'
import type { SavedDataset } from '@/store/datasets'
import type { PresetSummary, SdtaConfig } from '@/lib/feature-preset'

/**
 * Pins the exact drift the FP-3 plan warned about: `resetDatasetWizardAtom`
 * already omits four atoms that `initDatasetWizardAtom` clears, because the
 * two lists are maintained by hand and nothing enforces they agree. Adding
 * three more atoms without a test is how that list grows to eight.
 */

const SUMMARY: PresetSummary = {
  id: 'row-1',
  presetId: 'u-101-no1',
  unit: 'U-101',
  configNo: 1,
  name: 'U-101 No.1 — U101FBP.lab',
  samplingPoint: 'RU-101 Overhead',
  targetY: 'U101FBP.lab',
  objectKey: 'feature-presets/ws-1/imp-1/u-101-no1.json',
  equationCount: 1,
  rawTagCount: 0,
  requiredBaseTags: ['GG001.PV'],
  incomplete: false,
}

const SDTA: SdtaConfig = {
  ranges: [{ from: '2022-09-01T00:00:00Z', to: '2023-01-01T00:00:00Z' }],
  conditions: [{ tag: 'GG203.PV', op: '<', value: 1700 }],
}

function seedAppliedPreset(store: ReturnType<typeof createStore>) {
  store.set(dwFeaturePresetAtom, SUMMARY)
  store.set(dwTargetTagAtom, 'U101FBP.lab')
  store.set(dwSdtaConfigAtom, SDTA)
}

describe('feature preset atoms survive a fresh entry into the wizard', () => {
  it('initDatasetWizardAtom clears all three', () => {
    const store = createStore()
    seedAppliedPreset(store)

    store.set(initDatasetWizardAtom, {
      name: 'New dataset',
      description: '',
      workspaceId: 'ws-2',
      sources: [],
    })

    expect(store.get(dwFeaturePresetAtom)).toBeNull()
    expect(store.get(dwTargetTagAtom)).toBeNull()
    expect(store.get(dwSdtaConfigAtom)).toBeNull()
  })

  it('resetDatasetWizardAtom clears all three', () => {
    // The one this test exists for: reset already drifts from init by four
    // atoms, so a new atom is exactly the kind of thing that gets left out.
    const store = createStore()
    seedAppliedPreset(store)

    store.set(resetDatasetWizardAtom)

    expect(store.get(dwFeaturePresetAtom)).toBeNull()
    expect(store.get(dwTargetTagAtom)).toBeNull()
    expect(store.get(dwSdtaConfigAtom)).toBeNull()
  })

  it('a subsequent create is not contaminated by a prior preset apply', () => {
    // The concrete failure mode if the atoms were NOT cleared: opening a new
    // dataset would show "Applied from preset: …" for a preset the user never
    // touched in this run.
    const store = createStore()
    seedAppliedPreset(store)
    store.set(resetDatasetWizardAtom)
    store.set(dwWorkspaceIdAtom, 'ws-2')

    expect(store.get(dwFeaturePresetAtom)).toBeNull()
  })
})

describe('feature preset provenance round-trips through edit mode', () => {
  function editSeed(overrides: Partial<SavedDataset['pipelineConfig']> = {}) {
    return {
      dataset: {
        id: 'ds-1',
        name: 'Dataset',
        description: null,
        workspaceId: 'ws-1',
        sourceIds: [],
        tags: ['GG001.PV'],
        pipelineConfig: { ...EMPTY_PIPELINE_CONFIG, ...overrides },
        fileUrl: null,
        rowCount: 0,
        missingPct: 0,
        createdById: 'user-1',
        createdAt: '2026-08-05T00:00:00Z',
        updatedAt: '2026-08-05T00:00:00Z',
        currentVersionId: null,
        currentArtifactId: null,
        currentArtifactType: null,
      } as unknown as SavedDataset,
      sources: [],
    }
  }

  it('hydrates provenance and target from a saved recipe', () => {
    const store = createStore()

    store.set(
      initDatasetWizardForEditAtom,
      editSeed({ featurePreset: SUMMARY, targetTag: 'U101FBP.lab' }),
    )

    expect(store.get(dwFeaturePresetAtom)).toEqual(SUMMARY)
    expect(store.get(dwTargetTagAtom)).toBe('U101FBP.lab')
  })

  it('hydrates to null for a legacy recipe that predates these fields', () => {
    const store = createStore()

    store.set(initDatasetWizardForEditAtom, editSeed())

    expect(store.get(dwFeaturePresetAtom)).toBeNull()
    expect(store.get(dwTargetTagAtom)).toBeNull()
  })

  it('never hydrates an SD&TA config — it is import-time state, not persisted', () => {
    const store = createStore()
    seedAppliedPreset(store)

    store.set(
      initDatasetWizardForEditAtom,
      editSeed({ featurePreset: SUMMARY, targetTag: 'U101FBP.lab' }),
    )

    expect(store.get(dwSdtaConfigAtom)).toBeNull()
  })
})
