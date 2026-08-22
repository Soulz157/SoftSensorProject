import { describe, it, expect } from 'vitest'
import {
  describeAnalysisReadiness,
  type AnalysisReadiness,
} from './dataset-readiness'
import type {
  BronzeWarmState,
  PreviewSampleFetchState,
} from '@/store/dataset-studio'

const BASE = {
  fetchRequired: true,
  bronzeWarmState: 'idle' as const,
  previewFetchState: 'idle' as const,
  sampleTagCount: 0,
}

describe('describeAnalysisReadiness (DS-LAKE-015-T03)', () => {
  it('AC1: reports "preparing" while the artifact is still materializing, not a bare empty chart', () => {
    const result = describeAnalysisReadiness({
      ...BASE,
      bronzeWarmState: 'materializing',
    })
    expect(result.phase).toBe('preparing')
    expect((result as { caption: string }).caption).toMatch(/preparing/i)
  })

  it('AC2/AC3: the three busy phases are distinguishable, and none of their captions is a percentage', () => {
    const materializing = describeAnalysisReadiness({
      ...BASE,
      bronzeWarmState: 'materializing',
    })
    const loading = describeAnalysisReadiness({
      ...BASE,
      bronzeWarmState: 'ready',
      previewFetchState: 'loading',
    })
    const readyEmpty = describeAnalysisReadiness({
      ...BASE,
      bronzeWarmState: 'ready',
      previewFetchState: 'ready',
      sampleTagCount: 0,
    })

    expect(
      new Set([materializing.phase, loading.phase, readyEmpty.phase]).size,
    ).toBe(3)
    for (const result of [materializing, loading, readyEmpty]) {
      expect((result as { caption: string }).caption).not.toMatch(
        /%|\d+\s*\/\s*\d+/,
      )
    }
  })

  it('a CSV-only wizard (fetchRequired: false) never reads "preparing", even if the atom is stuck at idle forever', () => {
    expect(
      describeAnalysisReadiness({
        ...BASE,
        fetchRequired: false,
        bronzeWarmState: 'idle',
      }).phase,
    ).toBe('ready')
  })

  it('AC4: a FAILED background warm resolves to "ready" — invisible, same as before this feature', () => {
    expect(
      describeAnalysisReadiness({
        ...BASE,
        bronzeWarmState: 'failed',
      }).phase,
    ).toBe('ready')
  })

  it('V02: a failed preview-sample fetch reports an "error" phase rather than sitting in loading forever', () => {
    const result = describeAnalysisReadiness({
      ...BASE,
      bronzeWarmState: 'ready',
      previewFetchState: 'error',
    })
    expect(result.phase).toBe('error')
    expect((result as { caption: string }).caption).toMatch(/could not load/i)
  })

  it('ready with real columns carries no caption — the normal, fully-loaded state', () => {
    const result = describeAnalysisReadiness({
      ...BASE,
      bronzeWarmState: 'ready',
      previewFetchState: 'ready',
      sampleTagCount: 3,
    })
    expect(result).toEqual({ phase: 'ready' })
  })

  it('materializing outranks a stale loading/error preview state from a prior draft', () => {
    expect(
      describeAnalysisReadiness({
        ...BASE,
        bronzeWarmState: 'materializing',
        previewFetchState: 'error',
      }).phase,
    ).toBe('preparing')
  })

  // Full matrix: fetchRequired x bronzeWarmState x previewFetchState x
  // sampleTagCount. Mirrors the plan's phase decision table, rows 1-7 —
  // first-match-wins semantics.
  const BRONZE_STATES: BronzeWarmState[] = [
    'idle',
    'materializing',
    'ready',
    'failed',
  ]
  const PREVIEW_STATES: PreviewSampleFetchState[] = [
    'idle',
    'loading',
    'ready',
    'error',
  ]
  const TAG_COUNTS = [0, 3]

  function expectedPhase(
    fetchRequired: boolean,
    bronzeWarmState: BronzeWarmState,
    previewFetchState: PreviewSampleFetchState,
    sampleTagCount: number,
  ): AnalysisReadiness['phase'] {
    if (fetchRequired && bronzeWarmState === 'materializing') return 'preparing'
    if (previewFetchState === 'loading') return 'loading'
    if (previewFetchState === 'error') return 'error'
    if (previewFetchState === 'ready' && sampleTagCount === 0) return 'empty'
    return 'ready'
  }

  describe('full matrix', () => {
    for (const fetchRequired of [true, false]) {
      for (const bronzeWarmState of BRONZE_STATES) {
        for (const previewFetchState of PREVIEW_STATES) {
          for (const sampleTagCount of TAG_COUNTS) {
            const expected = expectedPhase(
              fetchRequired,
              bronzeWarmState,
              previewFetchState,
              sampleTagCount,
            )
            it(`fetchRequired=${fetchRequired} bronze=${bronzeWarmState} preview=${previewFetchState} tags=${sampleTagCount} -> ${expected}`, () => {
              expect(
                describeAnalysisReadiness({
                  fetchRequired,
                  bronzeWarmState,
                  previewFetchState,
                  sampleTagCount,
                }).phase,
              ).toBe(expected)
            })
          }
        }
      }
    }
  })

  it('CSV-only idle case (row 6): fetchRequired=false, bronze=idle, preview=idle, tags=0 -> ready', () => {
    expect(
      describeAnalysisReadiness({
        fetchRequired: false,
        bronzeWarmState: 'idle',
        previewFetchState: 'idle',
        sampleTagCount: 0,
      }),
    ).toEqual({ phase: 'ready' })
  })
})
