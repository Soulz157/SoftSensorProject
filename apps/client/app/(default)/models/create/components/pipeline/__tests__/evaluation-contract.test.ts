import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  ACTUAL_COLOR,
  AVP_LEGEND,
  PREDICT_COLOR,
  SD_BAND_COLOR,
} from '../evaluation/actual-vs-predicted-chart'
import {
  RESIDUAL_COLOR,
  RESIDUAL_LEGEND,
  SD1_COLOR,
  SD2_COLOR,
  SD3_COLOR,
} from '../evaluation/residual-chart'
import {
  DOT_COLOR,
  IDENTITY_COLOR,
  PARITY_LEGEND,
} from '../evaluation/parity-scatter-chart'

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

/**
 * MODEL-FLOW-019-V27. Each legend swatch must equal the value the chart
 * DRAWS with — proven here by importing the SAME exported binding each
 * legend entry and each JSX colour prop reads, rather than a hardcoded
 * literal a test could get right by coincidence while the two drifted
 * apart in the component itself.
 */
describe('Legend colours match the marks they explain (MODEL-FLOW-019-T17/V27)', () => {
  it("Actual vs Predicted legend equals the chart's own exported colours", () => {
    expect(AVP_LEGEND.find(e => e.label === 'Actual')?.color).toBe(ACTUAL_COLOR)
    expect(AVP_LEGEND.find(e => e.label === 'Predicted')?.color).toBe(
      PREDICT_COLOR,
    )
    expect(AVP_LEGEND.find(e => e.label === '±1 SD band')?.color).toBe(
      SD_BAND_COLOR,
    )
  })

  it("Residuals legend equals the chart's own exported colours", () => {
    expect(RESIDUAL_LEGEND.find(e => e.label === 'Residual')?.color).toBe(
      RESIDUAL_COLOR,
    )
    expect(RESIDUAL_LEGEND.find(e => e.label === '±1 SD')?.color).toBe(
      SD1_COLOR,
    )
    expect(RESIDUAL_LEGEND.find(e => e.label === '±2 SD')?.color).toBe(
      SD2_COLOR,
    )
    expect(RESIDUAL_LEGEND.find(e => e.label === '±3 SD')?.color).toBe(
      SD3_COLOR,
    )
  })

  it("Parity legend equals the chart's own exported colours", () => {
    expect(PARITY_LEGEND.find(e => e.shape === 'dot')?.color).toBe(DOT_COLOR)
    expect(PARITY_LEGEND.find(e => e.shape === 'dashed')?.color).toBe(
      IDENTITY_COLOR,
    )
  })
})

/**
 * MODEL-FLOW-019-V31. The identity line reads as the identity line, never
 * as a second model ('Baseline' names a REFERENCE MODEL in this codebase's
 * own vocabulary — see `parity-scatter-chart.tsx`'s doc comment — and this
 * chart draws no such series). Its two entries must differ by swatch
 * SHAPE, not only by colour, so the legend reads in greyscale too.
 */
describe('Parity legend wording and shape (MODEL-FLOW-019-T17/V31)', () => {
  it('names the identity line "y = x" and never "baseline"', () => {
    const line = PARITY_LEGEND.find(e => e.shape === 'dashed')
    expect(line?.label).toMatch(/y = x/)
    expect(PARITY_LEGEND.some(e => /baseline/i.test(e.label))).toBe(false)
  })

  it('gives its two entries different swatch shapes', () => {
    const shapes = PARITY_LEGEND.map(e => e.shape)
    expect(new Set(shapes).size).toBe(shapes.length)
  })
})

/**
 * MODEL-FLOW-019-V30. `residuals`/`histogramBins`/`qq` must depend ONLY on
 * `fit`, never on `zoom` — a static-source proof of the invariant the
 * diagnostics copy states in prose, since an interaction test driving
 * `ChartZoomControls` would only re-confirm the same dependency array at
 * runtime with more moving parts. `visibleRows`/`tickFormatter`, which DO
 * feed the two charts above the diagnostics section, must depend on
 * `zoom` — proving the split is real on BOTH sides, not just claimed.
 */
describe('Zoom-scope split is structural, not just stated (MODEL-FLOW-019-T16/V30)', () => {
  it('residuals, histogramBins and qq never list zoom as a dependency', () => {
    const src = read()
    expect(src).toMatch(
      /const residuals = useMemo\(\s*\(\) => [^,]+,\s*\[fit\],?\s*\)/,
    )
    expect(src).toMatch(
      /const histogramBins = useMemo\([\s\S]*?\[residuals\]\)/,
    )
    expect(src).toMatch(/const qq = useMemo\([\s\S]*?\[residuals\]\)/)
  })

  it('visibleRows and tickFormatter DO depend on zoom, driving the two charts above', () => {
    const src = read()
    expect(src).toMatch(
      /const visibleRows = useMemo\(\(\) => \{[\s\S]*?\}, \[rows, zoom\]\)/,
    )
    expect(src).toMatch(
      /const tickFormatter = useMemo\(\(\) => \{[\s\S]*?\}, \[visibleRows\]\)/,
    )
  })
})
