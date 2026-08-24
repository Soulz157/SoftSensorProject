import { describe, it, expect } from 'vitest'
import {
  lockedPresetRangeCandidates,
  presetRangeCandidatesFromDocument,
} from '@/store/dataset-studio'
import type { PresetDocument, PresetFeature } from '@/lib/feature-preset'

/**
 * `lockedPresetRangeCandidates` is what Step 3.1's edit-mode-only "Apply
 * Preset" button uses instead of Step 1's tag-adding path (`step-1-tags.tsx`
 * locks tags once a dataset exists — changing them would break downstream
 * model schemas). It must never surface a candidate for a tag the dataset
 * doesn't already have, since nothing downstream can add one.
 */

function feature(overrides: Partial<PresetFeature> = {}): PresetFeature {
  return {
    type: 'raw_tag',
    name: 'TI-101',
    formula: null,
    description: '',
    range: '105-120 C',
    range_parsed: {
      kind: 'closed',
      min: 105,
      max: 120,
      unit: 'C',
      raw: '105-120 C',
    },
    relation: '+',
    required_base_tags: ['TI-101'],
    parse_warnings: [],
    ...overrides,
  }
}

function doc(overrides: Partial<PresetDocument> = {}): PresetDocument {
  const features = overrides.features ?? [feature()]
  return {
    schema_version: 2,
    preset_id: 's-204-no1',
    unit: 'S-204',
    config_no: 1,
    name: 'S-204 No.1',
    plant: 'ACME',
    sampling_point: 'RU-204',
    target_y: 'FIC204.PV',
    required_base_tags: [
      ...new Set(features.flatMap(f => f.required_base_tags)),
    ].sort(),
    incomplete: false,
    ...overrides,
    features,
  }
}

describe('presetRangeCandidatesFromDocument', () => {
  it('keeps a raw_tag feature with a parseable, non-none range', () => {
    const document = doc()

    const candidates = presetRangeCandidatesFromDocument(document)

    expect(candidates).toEqual([
      {
        tag: 'TI-101',
        rowLabel: 'TI-101',
        quotedRange: '105-120 C',
        parsed: {
          kind: 'closed',
          min: 105,
          max: 120,
          unit: 'C',
          raw: '105-120 C',
        },
        presetId: 's-204-no1',
        configNo: 1,
        sheet: 'S-204',
      },
    ])
  })

  it('excludes equation features — the derived column does not exist until Step 4', () => {
    const document = doc({
      features: [
        feature({
          type: 'equation',
          name: 'Spgr',
          required_base_tags: ['A', 'B'],
        }),
      ],
    })

    expect(presetRangeCandidatesFromDocument(document)).toEqual([])
  })

  it('excludes a range parsed as kind: none', () => {
    const document = doc({
      features: [
        feature({
          range: '-',
          range_parsed: {
            kind: 'none',
            min: null,
            max: null,
            unit: null,
            raw: '-',
          },
        }),
      ],
    })

    expect(presetRangeCandidatesFromDocument(document)).toEqual([])
  })
})

describe('lockedPresetRangeCandidates', () => {
  it('keeps every candidate whose tag is already in the locked set, skips none', () => {
    const document = doc({
      features: [
        feature({ name: 'TI-101', required_base_tags: ['TI-101'] }),
        feature({
          name: 'FI-204',
          required_base_tags: ['FI-204'],
          range: '10-20 tph',
          range_parsed: {
            kind: 'closed',
            min: 10,
            max: 20,
            unit: 'tph',
            raw: '10-20 tph',
          },
        }),
      ],
    })

    const result = lockedPresetRangeCandidates(document, ['TI-101', 'FI-204'])

    expect(result.candidates.map(c => c.tag)).toEqual(['TI-101', 'FI-204'])
    expect(result.skippedCount).toBe(0)
  })

  it('drops a candidate whose tag is not in the locked set, and counts it as skipped — never adds the tag', () => {
    const document = doc({
      features: [
        feature({ name: 'TI-101', required_base_tags: ['TI-101'] }),
        feature({
          name: 'FI-204',
          required_base_tags: ['FI-204'],
          range: '10-20 tph',
          range_parsed: {
            kind: 'closed',
            min: 10,
            max: 20,
            unit: 'tph',
            raw: '10-20 tph',
          },
        }),
      ],
    })

    const result = lockedPresetRangeCandidates(document, ['TI-101'])

    expect(result.candidates.map(c => c.tag)).toEqual(['TI-101'])
    expect(result.skippedCount).toBe(1)
  })

  it('accepts a Set as well as an array for the locked-tags argument', () => {
    const document = doc()

    const result = lockedPresetRangeCandidates(document, new Set(['TI-101']))

    expect(result.candidates).toHaveLength(1)
    expect(result.skippedCount).toBe(0)
  })

  it('an empty locked set skips every candidate', () => {
    const document = doc()

    const result = lockedPresetRangeCandidates(document, [])

    expect(result.candidates).toEqual([])
    expect(result.skippedCount).toBe(1)
  })
})
