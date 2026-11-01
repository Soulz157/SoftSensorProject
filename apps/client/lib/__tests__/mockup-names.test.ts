import { describe, expect, it } from 'vitest'
import {
  findLeaks,
  invertTokens,
  remapNames,
  tokenReplacer,
  type MockupNameMap,
} from '../mockup-names'

const MAP: MockupNameMap = {
  byId: { ws1: 'Olefins Unit', ws2: 'Aromatics', plant1: 'Plant A' },
  tokens: {
    'Dataset-s611water': 'Dataset-B',
    's611water.lab': 'Lab Quality-2',
    s611water: 'Quality Model B',
    'AI602A.PV': 'Analyzer-4',
  },
  leakTokens: ['s611water', 'AI602', 'ROC', 'MOC'],
}

describe('remapNames', () => {
  it('rewrites tag names in keys and in string values', () => {
    const out = remapNames(
      {
        series: { 'AI602A.PV': [1], 's611water.lab': [2] },
        reason: 'AI602A.PV is out of range',
        target: 's611water.lab',
      },
      MAP,
    )
    expect(Object.keys(out.series)).toEqual(['Analyzer-4', 'Lab Quality-2'])
    expect(out.reason).toBe('Analyzer-4 is out of range')
    expect(out.target).toBe('Lab Quality-2')
  })

  it('takes the longest token first', () => {
    expect(tokenReplacer(MAP.tokens)('Dataset-s611water / s611water')).toBe(
      'Dataset-B / Quality Model B',
    )
  })

  it('does not match inside a longer word', () => {
    expect(tokenReplacer(MAP.tokens)('XAI602A.PV2')).toBe('XAI602A.PV2')
  })

  it('renames by id, so two entities sharing a real name stay apart', () => {
    const out = remapNames(
      [
        { id: 'ws2', name: 'MOC' },
        { id: 'plant1', name: 'MOC' },
        { id: 'other', name: 'MOC' },
      ],
      MAP,
    )
    expect(out.map(o => o.name)).toEqual(['Aromatics', 'Plant A', 'MOC'])
  })

  it('renames <x>Name beside a known <x>Id', () => {
    const out = remapNames({ workspaceId: 'ws1', workspaceName: 'ROC' }, MAP)
    expect(out.workspaceName).toBe('Olefins Unit')
  })

  it('leaves non-strings and enum words alone', () => {
    const out = remapNames({ status: 'PROCESSING', n: 3, ok: true }, MAP)
    expect(out).toEqual({ status: 'PROCESSING', n: 3, ok: true })
  })
})

describe('remapNames — per-entity fields', () => {
  const map: MockupNameMap = {
    ...MAP,
    fieldsById: { u1: { firstName: 'Alex', email: 'alex@example.com' } },
    exactValues: { 'Real Person': 'Alex Morgan' },
  }

  it('overwrites only fields the entity already has', () => {
    const out = remapNames({ id: 'u1', firstName: 'Real', role: 'USER' }, map)
    expect(out).toEqual({ id: 'u1', firstName: 'Alex', role: 'USER' })
  })

  it('replaces a whole free-text value, not a fragment of one', () => {
    const out = remapNames(
      { deployedBy: 'Real Person', note: 'Real Person said hi' },
      map,
    )
    expect(out).toEqual({
      deployedBy: 'Alex Morgan',
      note: 'Real Person said hi',
    })
  })

  it('leaves credentials untouched', () => {
    const out = remapNames({ accessToken: 'x.AI602A.PV.y' }, map)
    expect(out.accessToken).toBe('x.AI602A.PV.y')
  })
})

describe('invertTokens', () => {
  it('maps a mock name back to the real one', () => {
    const toReal = tokenReplacer(invertTokens(MAP.tokens))
    expect(toReal('/x?column=Analyzer-4')).toBe('/x?column=AI602A.PV')
  })
})

describe('findLeaks', () => {
  it('reports real fragments but not enum words', () => {
    expect(findLeaks('"PROCESSING" "ROC" FIC AI602B.PV', MAP.leakTokens)).toEqual(
      ['AI602', 'ROC'],
    )
  })
})
