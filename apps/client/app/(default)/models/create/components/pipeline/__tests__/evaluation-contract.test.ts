import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * MODEL-FLOW-004. Static-source guard, in the spirit of
 * `dataset-review-contract.test.ts`'s own MODEL-FLOW-010-V02 (a new file, not
 * an addition there — that file is mid-edit on a separate, uncommitted
 * branch of work).
 *
 * Before this feature, `phase-3-evaluation.tsx` re-materialised the dataset
 * in the browser and fit an OLS line over one arbitrary feature pair,
 * regardless of which algorithm actually trained — see `lib/model-metrics.ts`
 * `computeFit`'s own removed doc comment. This pins the mock's absence so it
 * cannot creep back in: a render test proves the numbers on screen are real
 * for the cases it covers, but only a source check proves the CODE PATH that
 * could fabricate them is gone, for every case.
 */

const STEP_FILE = path.resolve(__dirname, '../phase-3-evaluation.tsx')

function read(): string {
  return readFileSync(STEP_FILE, 'utf-8')
}

describe('Evaluation step contract (MODEL-FLOW-004)', () => {
  it('imports no client-side OLS fit', () => {
    expect(read()).not.toMatch(/\bcomputeFit\b/)
  })

  it('imports no raw dataset row source', () => {
    const src = read()
    expect(src).not.toMatch(
      /from ['"]@\/hooks\/dataset\/use-dataset-version-rows['"]/,
    )
    expect(src).not.toMatch(/\buseDatasetVersionRows\b/)
  })

  it('imports no dataset-recipe materializer', () => {
    const src = read()
    expect(src).not.toMatch(/\bmaterializeFromVersion\b/)
    expect(src).not.toMatch(/\bmaterializeDataset\b/)
  })

  it('reads the run through useDraftRunEvaluation, not a wizard atom guess', () => {
    const src = read()
    expect(src).toMatch(
      /from ['"]@\/hooks\/model\/use-draft-run-evaluation['"]/,
    )
    expect(src).toMatch(/useDraftRunEvaluation\(/)
  })
})
