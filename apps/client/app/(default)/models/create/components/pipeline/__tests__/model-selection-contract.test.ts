import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * MODEL-FLOW-017-V05. Static-source guard, in the spirit of
 * `evaluation-contract.test.ts`'s own MODEL-FLOW-004 guard.
 *
 * MODEL-FLOW-013-T05a established `renderModeFor(candidate)` as the SINGLE
 * branch site for which per-algorithm diagnostic renders — keyed on whether
 * the run has a `lossHistory`, never on `candidate.algorithm`. The base
 * chart this feature adds is unconditional (every terminal candidate gets
 * one) and must never grow a second branch keyed on the algorithm name; a
 * render test proves today's algorithms behave correctly, but only a source
 * check proves the CODE PATH that could reintroduce a membership list is
 * absent — the exact gap this guard exists to close before lstm/gru unblock
 * or the catalogue grows again.
 */

const STEP_FILE = path.resolve(__dirname, '../phase-4-model-selection.tsx')
const BASE_CHART_FILE = path.resolve(
  __dirname,
  '../model-selection/candidate-base-chart.tsx',
)
const OVERLAY_CHART_FILE = path.resolve(
  __dirname,
  '../model-selection/candidate-overlay-chart.tsx',
)

function read(file: string): string {
  return readFileSync(file, 'utf-8')
}

// A comparison keyed on the algorithm string itself — `candidate.algorithm
// === 'ols'`, `run.algorithm !== 'ridge'`, etc. Deliberately does NOT flag
// `ALGORITHM_LABELS[candidate.algorithm]` (a label lookup, not a behaviour
// branch) or `algorithm: candidate.algorithm` (data pass-through).
const ALGORITHM_EQUALITY_BRANCH = /\.?algorithm\s*[!=]==/

// A `switch` keyed on an algorithm value.
const ALGORITHM_SWITCH_BRANCH = /switch\s*\([^)]*algorithm[^)]*\)/

describe('Model Selection base-chart contract (MODEL-FLOW-017)', () => {
  it('phase-4-model-selection.tsx has no branch keyed on algorithm equality', () => {
    expect(read(STEP_FILE)).not.toMatch(ALGORITHM_EQUALITY_BRANCH)
  })

  it('phase-4-model-selection.tsx has no switch keyed on algorithm', () => {
    expect(read(STEP_FILE)).not.toMatch(ALGORITHM_SWITCH_BRANCH)
  })

  it("the base chart component branches on nothing but the run's own recorded fields", () => {
    const src = read(BASE_CHART_FILE)
    expect(src).not.toMatch(ALGORITHM_EQUALITY_BRANCH)
    expect(src).not.toMatch(ALGORITHM_SWITCH_BRANCH)
    expect(src).not.toMatch(/candidate\.algorithm/)
  })

  it('the overlay chart component uses algorithm only for its legend label, never a branch', () => {
    const src = read(OVERLAY_CHART_FILE)
    expect(src).not.toMatch(ALGORITHM_EQUALITY_BRANCH)
    expect(src).not.toMatch(ALGORITHM_SWITCH_BRANCH)
  })

  it('renderModeFor remains the only mode-branch function imported by the step', () => {
    const src = read(STEP_FILE)
    const importedModeHelpers =
      src.match(/renderModeFor|modeARows|modeBMarks/g) ?? []
    // Present (mode A/B diagnostic still exists) but never duplicated by a
    // second, differently-named branch function doing the same job.
    expect(importedModeHelpers.length).toBeGreaterThan(0)
    expect(src).not.toMatch(/function\s+(getRenderMode|resolveMode|pickMode)\b/)
  })
})
