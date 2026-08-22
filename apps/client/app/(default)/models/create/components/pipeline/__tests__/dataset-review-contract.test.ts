import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * MODEL-FLOW-010-V02. A static-source check, not a render: the guarantee is
 * about what the step's files import and which props they pass, which a
 * render observes no more directly than reading the source does, and a render
 * would need a live jotai context plus mocks for six hooks for no extra
 * coverage.
 *
 * REVISED 2026-08-21. This test used to assert the step imports NO
 * `DataAnalysisCard`, because that component was welded to the data-studio
 * draft store. The card was since made store-agnostic and the step now mounts
 * it deliberately, so the blanket ban is gone — but the reasons behind it are
 * not, and they become the assertions below:
 *
 *   - the step still reads no `dw*` atom of its own (the store-split rule:
 *     a wrong-store read is silent empty data, not a loud failure);
 *   - the card is given an EXPLICIT dataset/artifact, so its server-backed
 *     tabs route through dataset-scoped requests instead of resolving to the
 *     null draft atoms and sitting on 'pending' forever;
 *   - the card's scaler dialog is switched OFF, because it WRITES
 *     `dwScalerConfigsAtom` and this step's contract is that it configures
 *     nothing.
 *
 * Dropping any of those three silently restores the original defect, which is
 * why they are pinned individually rather than by banning the import.
 */

const STEP_DIR = path.resolve(__dirname, '..')

/**
 * `dataset-review/preview-correlation-panel.tsx` is deliberately absent: the
 * card's Raw Table and Correlation tabs replaced it, so it is no longer
 * mounted. The file is kept on disk to make restoring it a one-line change.
 */
const STEP_FILES = [
  'phase-2-dataset-review.tsx',
  'dataset-review/source-identity-panel.tsx',
  'dataset-review/per-tag-stats-panel.tsx',
  'dataset-review/holdout-panel.tsx',
]

function read(file: string): string {
  return readFileSync(path.join(STEP_DIR, file), 'utf-8')
}

describe('Dataset Review step contract (MODEL-FLOW-010-V02)', () => {
  it.each(STEP_FILES)(
    '%s imports no dw* atom from store/dataset-studio',
    file => {
      const src = read(file)
      expect(src).not.toMatch(/from ['"]@\/store\/dataset-studio['"]/)
    },
  )

  it('the step reads its preview through useArtifactRows, not an unbounded fetch', () => {
    const src = read('phase-2-dataset-review.tsx')
    expect(src).toMatch(
      /from ['"]@\/hooks\/dataset\/artifact\/use-artifact-rows['"]/,
    )
    expect(src).toMatch(/useArtifactRows\(/)
  })

  it('DataAnalysisCard is given an explicit dataset and artifact, not left to the draft atoms', () => {
    const src = read('phase-2-dataset-review.tsx')
    // Without both, the card falls back to `dw*` routing, which is null in
    // the model wizard — histogram/boxplot/scatter/correlation would render
    // 'pending' permanently rather than failing visibly.
    expect(src).toMatch(/datasetId=\{datasetId\}/)
    expect(src).toMatch(/artifactId=\{artifactId\}/)
  })

  it('DataAnalysisCard mounts with transforms disabled — this step configures nothing', () => {
    const src = read('phase-2-dataset-review.tsx')
    // FeatureTransformDialog writes dwScalerConfigsAtom. Mounting it here
    // would let a reviewer silently edit an unrelated dataset draft.
    expect(src).toMatch(/showTransforms=\{false\}/)
  })
})
