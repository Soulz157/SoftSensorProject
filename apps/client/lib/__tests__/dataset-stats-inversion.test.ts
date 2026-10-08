/**
 * DS-LAKE-028-T06 / V03. The column_stats sidecar is computed on the frame
 * `to_model_ready` RETURNED (artifact_service.py:896 -> :936), so every
 * per-tag number it holds is in [0,1] for a saved dataset. These pin the one
 * way the conversion goes plausibly wrong.
 */
import { describe, expect, it } from 'vitest'

import { perTagStatsOrdered } from '@/lib/dataset-stats'
import type { ArtifactTagColumnStats } from '@/services/dataset-version'

const TAG = 'TI-101'

// Offset 5,000 and slope 40,000 — an offset that is NOT zero is the whole
// point: with offset 0 a spread and a position convert identically, so such
// a fixture cannot tell the two apart.
const PARAMS = { [TAG]: { min: 5_000, max: 45_000 } }

function stats(over: Partial<ArtifactTagColumnStats> = {}) {
  const base: ArtifactTagColumnStats = {
    tag: TAG,
    coverage: 0.98,
    null_pct: 0.02,
    outlier_count: 3,
    min: 0,
    max: 1,
    mean: 0.5,
    median: 0.5,
    std: 0.25,
    drift: 0.1,
    percentiles: { p50: 0.5, p95: 0.9 },
    cleaned: true,
    ...over,
  }
  return { [TAG]: base }
}

describe('perTagStatsOrdered inversion', () => {
  it('moves a position by the offset and scales a spread by the slope alone', () => {
    const [row] = perTagStatsOrdered([TAG], stats(), PARAMS)

    // Positions: full affine map.
    expect(row!.mean).toBe(25_000)
    expect(row!.min).toBe(5_000)
    expect(row!.max).toBe(45_000)
    expect(row!.percentiles).toEqual({ p50: 25_000, p95: 41_000 })

    // Spread: slope ONLY. Running the std through the full map would give
    // 5,000 + 0.25*40,000 = 15,000 — a plausible number, and wrong by the
    // entire offset. That is the failure this test exists to catch.
    expect(row!.std).toBe(10_000)
    expect(row!.std).not.toBe(15_000)
  })

  it('leaves unitless fields and drift alone', () => {
    const [row] = perTagStatsOrdered([TAG], stats(), PARAMS)
    // Counts, ratios and flags are invariant under a positive affine map;
    // `drift` is a statement ABOUT the scaling, not a value in its units.
    expect(row!.coverage).toBe(0.98)
    expect(row!.null_pct).toBe(0.02)
    expect(row!.outlier_count).toBe(3)
    expect(row!.cleaned).toBe(true)
    expect(row!.drift).toBe(0.1)
  })

  it('returns rows untouched when no params are passed at all', () => {
    // An artifact with no spec is not an artifact that was never scaled, and
    // this function must not pretend otherwise by inventing an identity map.
    const [row] = perTagStatsOrdered([TAG], stats())
    expect(row!.mean).toBe(0.5)
    expect(row!.std).toBe(0.25)
  })

  it('returns a tag untouched when only OTHER tags have recorded params', () => {
    const [row] = perTagStatsOrdered([TAG], stats(), { 'VI-202': { min: 0, max: 1 } })
    expect(row!.mean).toBe(0.5)
  })

  it('preserves a null statistic as null rather than converting it to a number', () => {
    const [row] = perTagStatsOrdered([TAG], stats({ std: null, mean: null }), PARAMS)
    expect(row!.std).toBeNull()
    expect(row!.mean).toBeNull()
  })
})
