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

const STEP_FILE = path.resolve(__dirname, '../phase-5-evaluation.tsx')
const PARITY_CHART_FILE = path.resolve(
  __dirname,
  '../evaluation/parity-scatter-chart.tsx',
)

function read(): string {
  return readFileSync(STEP_FILE, 'utf-8')
}

/** Comments may legitimately explain WHY a symbol is absent (this file's
 *  own parity-chart doc comment does exactly that) — strip them so the
 *  check below proves no CODE uses the sync group, not that the word never
 *  appears in prose. */
function readParityChartCode(): string {
  return readFileSync(PARITY_CHART_FILE, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
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

/**
 * MODEL-FLOW-019-V20. `syncId` never reaches the DOM through Recharts, so a
 * render assertion cannot distinguish an unsynced chart from a synced one
 * whose axes happen to overlap — only a source check can prove the parity
 * scatter was never joined to the time-axis sync group
 * (`EVAL_SYNC_ID`, `actual-vs-predicted-chart.tsx`/`residual-chart.tsx`).
 * That group shares a TIME x-axis; this chart's x-axis is `y_true`, so
 * joining it would crosshair-link two incompatible axes.
 */
describe('Parity scatter contract (MODEL-FLOW-019-T13/V20)', () => {
  it('carries no syncId prop and imports no EVAL_SYNC_ID', () => {
    const code = readParityChartCode()
    expect(code).not.toMatch(/\bsyncId\b/)
    expect(code).not.toMatch(/\bEVAL_SYNC_ID\b/)
  })
})
