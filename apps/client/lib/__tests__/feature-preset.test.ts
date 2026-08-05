import { describe, it, expect } from 'vitest'
import {
  canApply,
  compareTags,
  isLabTag,
  planPresetApplication,
  planSdtaApplication,
  requiredDatasetTags,
  toFeatureConfigs,
  type PresetDocument,
  type PresetFeature,
  type SdtaConfig,
} from '@/lib/feature-preset'
import type { DatasetTagRow } from '@/hooks/dataset/use-dataset-tag-table'
import { compileFormula, evalFormulaRow } from '@/lib/formula'
import type { FormulaFeature } from '@/lib/feature-engineering'

/**
 * Run a generated config the way `applyFeatures` will: compile the alias
 * expression and resolve each alias through `vars` against a row's cells.
 */
function evaluate(
  config: FormulaFeature,
  values: Record<string, number>,
): number | null {
  const cells = Object.fromEntries(
    Object.entries(values).map(([tag, value]) => [tag, { value }]),
  )
  return evalFormulaRow(compileFormula(config.expr), config.vars, { cells })
}

/**
 * The gate these tests defend: a preset may only be applied when every base tag
 * it needs is present AND healthy. The modal this replaces compared against a
 * plain `string[]`, which cannot see a row's status — so a tag whose Step-1 row
 * had failed still counted as Matched, and Apply queued a fetch for it.
 */

function feature(overrides: Partial<PresetFeature> = {}): PresetFeature {
  return {
    type: 'equation',
    name: 'Spgr_in_feed',
    formula: '(QQ001A2.PV*GG001.PV)/(GG003.PV+GG001.PV)',
    description: 'Spgr in feed',
    range: '-',
    relation: '+',
    required_base_tags: ['QQ001A2.PV', 'GG001.PV', 'GG003.PV'],
    parse_warnings: [],
    ...overrides,
  }
}

function doc(overrides: Partial<PresetDocument> = {}): PresetDocument {
  const features = overrides.features ?? [feature()]
  return {
    schema_version: 1,
    preset_id: 'u-101-no1',
    unit: 'U-101',
    config_no: 1,
    name: 'U-101 No.1 — U101FBP.lab',
    plant: 'ACME HOT',
    sampling_point: 'RU-101 Overhead',
    target_y: 'U101FBP.lab',
    required_base_tags: [
      ...new Set(features.flatMap(f => f.required_base_tags)),
    ].sort(),
    incomplete: false,
    ...overrides,
    features,
  }
}

function row(
  tagName: string,
  status: 'good' | 'error' = 'good',
  errorReason?: string,
): DatasetTagRow {
  return {
    id: `src::${tagName}`,
    tagName,
    originalName: tagName,
    dataSource: 'PI',
    status,
    errorReason,
  }
}

const HEALTHY = [row('QQ001A2.PV'), row('GG001.PV'), row('GG003.PV')]

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

describe('compareTags', () => {
  it('matches a tag whose row is present and healthy', () => {
    const result = compareTags(doc(), HEALTHY)

    expect(result.matched).toBe(3)
    expect(result.missing).toBe(0)
    expect(result.unhealthy).toBe(0)
    expect(result.ready).toBe(true)
    expect(result.readyPct).toBe(100)
  })

  it('does NOT count a present-but-errored tag as matched', () => {
    // The regression this whole three-state design exists for.
    const rows = [
      row('QQ001A2.PV'),
      row('GG001.PV', 'error', 'No data in range'),
      row('GG003.PV'),
    ]

    const result = compareTags(doc(), rows)

    expect(result.matched).toBe(2)
    expect(result.unhealthy).toBe(1)
    expect(result.missing).toBe(0)
    expect(result.ready).toBe(false)
  })

  it('blocks apply on an errored tag exactly as it does on a missing one', () => {
    const errored = compareTags(doc(), [
      row('QQ001A2.PV'),
      row('GG001.PV', 'error'),
      row('GG003.PV'),
    ])
    const absent = compareTags(doc(), [row('QQ001A2.PV'), row('GG003.PV')])

    expect(canApply(doc(), errored)).toBe(false)
    expect(canApply(doc(), absent)).toBe(false)
  })

  it('reports WHY an errored tag is unusable, so the user is not sent hunting', () => {
    const result = compareTags(doc(), [
      row('QQ001A2.PV'),
      row('GG001.PV', 'error', 'Tag not found on server'),
      row('GG003.PV'),
    ])
    const check = result.checks.find(c => c.tag === 'GG001.PV')

    expect(check?.status).toBe('error')
    expect(check?.errorReason).toBe('Tag not found on server')
  })

  it('marks an absent tag missing', () => {
    const result = compareTags(doc(), [row('QQ001A2.PV'), row('GG003.PV')])

    expect(result.missing).toBe(1)
    expect(result.checks.find(c => c.tag === 'GG001.PV')?.status).toBe(
      'missing',
    )
  })

  it('resolves a case or whitespace near-miss and records what it resolved to', () => {
    const result = compareTags(doc(), [
      row('qq001a2.pv'),
      row('  GG001.PV  '),
      row('GG003.PV'),
    ])

    expect(result.ready).toBe(true)
    expect(result.checks.find(c => c.tag === 'QQ001A2.PV')?.mappedTo).toBe(
      'qq001a2.pv',
    )
  })

  it('leaves mappedTo null when the tag resolved to itself', () => {
    const result = compareTags(doc(), HEALTHY)

    expect(result.checks.every(c => c.mappedTo === null)).toBe(true)
  })

  it('honours an explicit override for a tag that would otherwise be missing', () => {
    const rows = [row('QQ001A2.PV'), row('GG003.PV'), row('GG001_ALT.PV')]

    const result = compareTags(doc(), rows, { 'GG001.PV': 'GG001_ALT.PV' })

    expect(result.ready).toBe(true)
    expect(result.checks.find(c => c.tag === 'GG001.PV')?.mappedTo).toBe(
      'GG001_ALT.PV',
    )
  })

  it('does not let a duplicate errored row shadow a healthy one', () => {
    const rows = [...HEALTHY, row('GG001.PV', 'error', 'stale duplicate')]

    expect(compareTags(doc(), rows).ready).toBe(true)
  })

  it('lists every feature that needs a shared tag', () => {
    const document = doc({
      features: [
        feature({ name: 'A' }),
        feature({ name: 'B', required_base_tags: ['GG001.PV'] }),
      ],
    })

    const check = compareTags(document, HEALTHY).checks.find(
      c => c.tag === 'GG001.PV',
    )

    expect(check?.usedIn).toEqual(['A', 'B'])
  })

  it('flags a lab tag so a missing one reads as "not joined yet"', () => {
    // .Lab tags appear as BASE tags inside real formulas, not only as targets.
    // Reporting one as a plain missing tag sends the user looking in the
    // historian for something that only exists in manual sample data.
    const document = doc({
      features: [
        feature({
          formula: '(WW001Spgr.Lab*GG001.PV)/GG003.PV',
          required_base_tags: ['WW001Spgr.Lab', 'GG001.PV', 'GG003.PV'],
        }),
      ],
    })

    const result = compareTags(document, HEALTHY)

    expect(result.checks.find(c => c.tag === 'WW001Spgr.Lab')?.status).toBe(
      'missing',
    )
    expect(result.checks.find(c => c.tag === 'WW001Spgr.Lab')?.isLabTag).toBe(
      true,
    )
    expect(result.checks.find(c => c.tag === 'GG001.PV')?.isLabTag).toBe(false)
  })

  it('recognises a lab tag whatever its casing', () => {
    expect(isLabTag('S204FBP.lab')).toBe(true)
    expect(isLabTag('WW001Spgr60/60f.Lab')).toBe(true)
    expect(isLabTag('TI202.PV')).toBe(false)
  })
})

describe('canApply', () => {
  it('refuses a preset whose sheet listed a target but no features', () => {
    // Four of the nine presets in the reference workbook are like this.
    const empty = doc({ features: [], incomplete: true })

    expect(canApply(empty, compareTags(empty, HEALTHY))).toBe(false)
  })

  it('allows a fully matched, complete preset', () => {
    expect(canApply(doc(), compareTags(doc(), HEALTHY))).toBe(true)
  })

  it('ignores the target, which is a lab tag no PI catalogue will have', () => {
    // Gating on it would block every preset in the source workbook.
    const result = compareTags(doc(), HEALTHY)

    expect(result.checks.some(c => c.tag === 'U101FBP.lab')).toBe(false)
    expect(canApply(doc(), result)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Feature configs
// ---------------------------------------------------------------------------

describe('toFeatureConfigs', () => {
  let counter = 0
  const ids = () => `id-${++counter}`

  /** First generated config, asserted present — every caller expects one. */
  function firstConfig(
    document: PresetDocument,
    overrides: Record<string, string> = {},
  ): FormulaFeature {
    counter = 0
    const [config] = toFeatureConfigs(
      document,
      overrides,
      ids,
    ) as FormulaFeature[]
    if (!config) throw new Error('expected at least one feature config')
    return config
  }

  it('converts an equation into an alias-form formula feature', () => {
    const config = firstConfig(doc())

    expect(config.kind).toBe('formula')
    expect(config.name).toBe('Spgr_in_feed')
    // The evaluator runs aliases, never raw tag names — a tag containing `.`
    // or `/` is not a valid mathjs symbol.
    expect(config.expr).not.toContain('QQ001A2.PV')
    expect(Object.values(config.vars)).toContain('QQ001A2.PV')
  })

  it('keeps the original expression for display', () => {
    const config = firstConfig(doc())

    expect(config.display).toBe('(QQ001A2.PV*GG001.PV)/(GG003.PV+GG001.PV)')
  })

  it('skips raw-tag features, which name columns that already exist', () => {
    counter = 0
    const document = doc({
      features: [
        feature(),
        feature({
          type: 'raw_tag',
          name: 'TT202.PV',
          formula: null,
          required_base_tags: ['TT202.PV'],
        }),
      ],
    })

    const configs = toFeatureConfigs(document, {}, ids)

    expect(configs).toHaveLength(1)
    expect((configs[0] as FormulaFeature).name).toBe('Spgr_in_feed')
  })

  it('re-points an overridden tag without touching the expression', () => {
    const plain = firstConfig(doc())
    const mapped = firstConfig(doc(), { 'GG001.PV': 'GG001_ALT.PV' })

    expect(mapped.expr).toBe(plain.expr)
    expect(Object.values(mapped.vars)).toContain('GG001_ALT.PV')
    expect(Object.values(mapped.vars)).not.toContain('GG001.PV')
  })

  it('produces an expression the evaluator can actually run', () => {
    // The real proof the alias form is correct: (2*3)/(4+3) = 6/7.
    const config = firstConfig(doc())

    const value = evaluate(config, {
      'QQ001A2.PV': 2,
      'GG001.PV': 3,
      'GG003.PV': 4,
    })

    expect(value).toBeCloseTo(6 / 7)
  })

  it('handles a tag whose own name contains a slash', () => {
    // `WW001Spgr60/60f.Lab` is ONE tag; the second slash is division. A
    // tokenizer that split on operators would shred the first name.
    counter = 0
    const document = doc({
      features: [
        feature({
          formula: '(WW001Spgr60/60f.Lab*GG001.PV)/GG003.PV',
          required_base_tags: ['WW001Spgr60/60f.Lab', 'GG001.PV', 'GG003.PV'],
        }),
      ],
    })

    const config = firstConfig(document)

    expect(Object.values(config.vars)).toContain('WW001Spgr60/60f.Lab')
    expect(
      evaluate(config, {
        'WW001Spgr60/60f.Lab': 2,
        'GG001.PV': 3,
        'GG003.PV': 6,
      }),
    ).toBeCloseTo(1)
  })

  it('gives every config a distinct id', () => {
    counter = 0
    const document = doc({
      features: [feature({ name: 'A' }), feature({ name: 'B' })],
    })

    const configs = toFeatureConfigs(document, {}, ids)

    expect(new Set(configs.map(c => c.id)).size).toBe(2)
  })
})

describe('requiredDatasetTags', () => {
  it('returns the preset base tags', () => {
    expect(requiredDatasetTags(doc()).sort()).toEqual([
      'GG001.PV',
      'GG003.PV',
      'QQ001A2.PV',
    ])
  })

  it('substitutes overrides so Step 2 fetches what was actually mapped', () => {
    const tags = requiredDatasetTags(doc(), { 'GG001.PV': 'GG001_ALT.PV' })

    expect(tags).toContain('GG001_ALT.PV')
    expect(tags).not.toContain('GG001.PV')
  })
})

describe('planPresetApplication', () => {
  it('unions required tags into the existing selection', () => {
    const plan = planPresetApplication(
      doc(),
      ['GG001.PV', 'GG003.PV'],
      ['TT202.PV'],
      HEALTHY,
    )

    expect(plan.selectedTags.sort()).toEqual(
      ['GG001.PV', 'GG003.PV', 'TT202.PV'].sort(),
    )
  })

  it('does not duplicate a tag already in the selection', () => {
    const plan = planPresetApplication(
      doc(),
      ['GG001.PV'],
      ['GG001.PV'],
      HEALTHY,
    )

    expect(plan.selectedTags.filter(t => t === 'GG001.PV')).toHaveLength(1)
  })

  it('adds the target when it resolves to a healthy row', () => {
    const rows = [...HEALTHY, row('U101FBP.lab')]

    const plan = planPresetApplication(doc(), [], [], rows)

    expect(plan.targetInCatalogue).toBe(true)
    expect(plan.selectedTags).toContain('U101FBP.lab')
  })

  it('records the target but does NOT add it when absent', () => {
    // Every workbook target is a .lab tag, absent from PI by construction —
    // requiring it here would mean Apply always drops it.
    const plan = planPresetApplication(doc(), [], [], HEALTHY)

    expect(plan.targetTag).toBe('U101FBP.lab')
    expect(plan.targetInCatalogue).toBe(false)
    expect(plan.selectedTags).not.toContain('U101FBP.lab')
  })

  it('does NOT add the target when its row exists but is in error', () => {
    // Present-but-broken must not silently become "selected for fetching" —
    // same rule as compareTags treating error as distinct from matched.
    const rows = [...HEALTHY, row('U101FBP.lab', 'error', 'No lab data')]

    const plan = planPresetApplication(doc(), [], [], rows)

    expect(plan.targetInCatalogue).toBe(false)
    expect(plan.selectedTags).not.toContain('U101FBP.lab')
  })
})

describe('planSdtaApplication', () => {
  const sdta = (overrides: Partial<SdtaConfig> = {}): SdtaConfig => ({
    ranges: [{ from: '2022-09-01T00:00:00Z', to: '2023-01-01T00:00:00Z' }],
    conditions: [{ tag: 'GG203.PV', op: '<', value: 1700 }],
    ...overrides,
  })

  it('turns each range into a time-only exclusion', () => {
    const plan = planSdtaApplication(sdta(), [row('GG203.PV')])

    expect(plan.exclusions).toEqual([
      {
        time: { from: '2022-09-01T00:00:00Z', to: '2023-01-01T00:00:00Z' },
        value: null,
      },
    ])
  })

  it('turns a condition on a healthy tag into an enabled drop rule', () => {
    const plan = planSdtaApplication(sdta(), [row('GG203.PV')], () => 'rule-1')

    expect(plan.conditionalRules).toEqual([
      {
        id: 'rule-1',
        tag: 'GG203.PV',
        op: '<',
        value: 1700,
        action: 'drop',
        enabled: true,
      },
    ])
    expect(plan.droppedConditions).toEqual([])
  })

  it('drops a condition whose tag is not in the dataset, rather than a dangling rule', () => {
    const plan = planSdtaApplication(sdta(), [])

    expect(plan.conditionalRules).toEqual([])
    expect(plan.droppedConditions).toEqual([
      { tag: 'GG203.PV', reason: 'Tag not in this dataset' },
    ])
  })

  it('drops a condition whose tag exists but is in error — same rule as compareTags', () => {
    const plan = planSdtaApplication(sdta(), [row('GG203.PV', 'error')])

    expect(plan.conditionalRules).toEqual([])
    expect(plan.droppedConditions).toEqual([
      { tag: 'GG203.PV', reason: 'Tag not in this dataset' },
    ])
  })

  it('refuses an operator outside CutoffOp instead of passing it through', () => {
    // Server output crossing a network boundary, not a compile-time
    // guarantee — an unrecognised op must not become an uninterpretable rule.
    const plan = planSdtaApplication(
      sdta({ conditions: [{ tag: 'GG203.PV', op: '<>', value: 1700 }] }),
      [row('GG203.PV')],
    )

    expect(plan.conditionalRules).toEqual([])
    expect(plan.droppedConditions).toEqual([
      { tag: 'GG203.PV', reason: 'Unsupported operator "<>"' },
    ])
  })

  it('accepts every operator the parser actually emits', () => {
    const conditions = ['<', '<=', '>', '>=', '=='].map(op => ({
      tag: 'GG203.PV',
      op,
      value: 100,
    }))

    const plan = planSdtaApplication(sdta({ conditions }), [row('GG203.PV')])

    expect(plan.conditionalRules).toHaveLength(5)
    expect(plan.droppedConditions).toEqual([])
  })

  it('handles multiple conditions independently — one bad tag does not sink the rest', () => {
    const plan = planSdtaApplication(
      sdta({
        conditions: [
          { tag: 'GG203.PV', op: '<', value: 1700 },
          { tag: 'MISSING.PV', op: '<', value: 100 },
        ],
      }),
      [row('GG203.PV')],
    )

    expect(plan.conditionalRules).toHaveLength(1)
    expect(plan.conditionalRules[0]?.tag).toBe('GG203.PV')
    expect(plan.droppedConditions).toEqual([
      { tag: 'MISSING.PV', reason: 'Tag not in this dataset' },
    ])
  })
})
