import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FeatureCountSweepTable } from '../evaluation/feature-count-sweep-table'
import { FeatureCountSweepLauncher } from '../evaluation/feature-count-sweep-launcher'
import { launchFeatureCountSweep } from '@/hooks/model/use-feature-count-sweep'
import type { ModelTrainingRunListItem } from '@/services/model-draft'
import type { DraftRunSummary } from '@/hooks/model/use-draft-run-evaluation'

// Only the launch call is faked — the hook beside it is left real, so this
// file never asserts against a mock of the thing it is testing.
vi.mock('@/hooks/model/use-feature-count-sweep', async importOriginal => {
  const actual =
    await importOriginal<
      typeof import('@/hooks/model/use-feature-count-sweep')
    >()
  return { ...actual, launchFeatureCountSweep: vi.fn() }
})

const mockLaunch = launchFeatureCountSweep as Mock

beforeEach(() => {
  mockLaunch.mockReset()
})

/**
 * MODEL-FLOW-019-T31. The RENDER-level half of this task's verification,
 * rebuilt with the panels after both were withdrawn on 2026-09-09.
 *
 * V41 and V42 stayed green through the withdrawal because they are pinned at
 * the lib level (lib/feature-count-sweep.test.ts, 19 cases over
 * `selectByOverlap`). What went with the components was the proof that the
 * table SHOWS what the rule decided — a lib function returning the right
 * runId proves nothing about which row a reader sees marked. V43 was never
 * closed at all, for the same reason.
 */

/** A CV row. `cvFoldsKey` is what makes `sourcedMetricsOf` read the `cv_*`
 *  aggregates — the run's own durable CV signal, never the algorithm name
 *  and never `splitSpec.method`. `feature_count` is the trainer's record of
 *  the columns it actually fit, which is what the table reads for `n`. */
function cvRun(
  overrides: Partial<ModelTrainingRunListItem> = {},
): ModelTrainingRunListItem {
  return {
    id: 'row-1',
    status: 'SUCCEEDED',
    failureReason: null,
    datasetId: 'ds-1',
    goldArtifactId: 'art-1',
    artifactChecksum: 'sha256:abc',
    featureSpecKey: 'feature_spec.json',
    featureColumns: ['TI-101'],
    sweepId: 'sweep-1',
    sweepSeedRunId: 'seed-run-0000',
    targetY: 'LAB-01',
    algorithm: 'random_forest',
    hyperparameters: {},
    seed: 42,
    // `splitSpec` has no CV variant, deliberately — CV-ness is carried by
    // `cvFoldsKey` alone, which is the rule this codebase states in several
    // places ("never `splitSpec.method`, never the algorithm name"). Leaving
    // this chronological is therefore correct, not a fixture shortcut.
    splitSpec: { method: 'chronological', ratio: 0.8 },
    imageDigest: 'sha256:0123456789abcdef',
    modelKey: 'model.joblib',
    metrics: null,
    holdoutMetrics: null,
    cvFoldsKey: 'cv_folds.json',
    featureImportanceKey: null,
    predictionsKey: null,
    holdoutPredictionsKey: null,
    scoringContainerId: null,
    lossHistoryKey: null,
    splitStats: null,
    candidateJobId: null,
    createdAt: '2026-09-11T00:00:00.000Z',
    startedAt: '2026-09-11T00:00:01.000Z',
    finishedAt: '2026-09-11T00:00:30.000Z',
    ...overrides,
  }
}

function row(
  id: string,
  n: number,
  rmseMean: number,
  rmseStd: number | null,
  extra: Partial<ModelTrainingRunListItem> = {},
): ModelTrainingRunListItem {
  return cvRun({
    id,
    metrics: {
      feature_count: n,
      cv_rmse_mean: rmseMean,
      ...(rmseStd === null ? {} : { cv_rmse_std: rmseStd }),
      cv_r2_mean: 0.9,
      cv_r2_std: 0.01,
      n_splits: 3,
    },
    ...extra,
  })
}

function cellsOf(featureCount: string): string[] {
  const cell = screen.getByRole('cell', { name: featureCount })
  const tr = cell.closest('tr')
  if (!tr) throw new Error(`no row for ${featureCount}`)
  return within(tr)
    .getAllByRole('cell')
    .map(c => c.textContent ?? '')
}

/**
 * THE FIXTURE IS BUILT SO THE ARGMIN AND THE RULE DISAGREE. n=7 has the lowest
 * mean (0.0522) but n=4 (0.0526 ± 0.0030) overlaps it, so the rule selects 4.
 * A fixture where the two agree could not tell a stated rule from a minimum —
 * which is exactly what V41 says.
 */
const LADDER = [
  row('row-4', 4, 0.0526, 0.003),
  row('row-5', 5, 0.055, 0.002),
  row('row-7', 7, 0.0522, 0.002),
]

describe('FeatureCountSweepTable — V41, the rule beats the argmin on screen', () => {
  it('marks the SMALLEST overlapping row as selected, not the lowest mean', () => {
    render(
      <FeatureCountSweepTable
        runs={LADDER}
        seedRunId="seed-run-0000"
        seedMethod="impurity"
        distinctLabelledValues={32}
      />,
    )

    expect(cellsOf('4').join(' ')).toMatch(/selected by the rule/)
    // The lowest mean is still SHOWN — hiding it would make the table's
    // answer unfalsifiable — but it is labelled as the mean, not the answer.
    expect(cellsOf('7').join(' ')).toMatch(/lowest mean/)
    expect(cellsOf('7').join(' ')).not.toMatch(/selected by the rule/)
  })

  it('says in words that the rule and the lowest mean disagree', () => {
    render(
      <FeatureCountSweepTable
        runs={LADDER}
        seedRunId="seed-run-0000"
        seedMethod="impurity"
        distinctLabelledValues={32}
      />,
    )
    expect(
      screen.getByText(/lowest fold mean is 7 features, but 4 is selected/i),
    ).toBeInTheDocument()
  })

  it('prints the rule rather than implying it with a bold row (AC67)', () => {
    render(
      <FeatureCountSweepTable
        runs={LADDER}
        seedRunId="seed-run-0000"
        seedMethod="impurity"
        distinctLabelledValues={32}
      />,
    )
    expect(
      screen.getByText(/Selected by rule, not by the lowest number/i),
    ).toBeInTheDocument()
  })
})

describe('FeatureCountSweepTable — V42, a row with no interval makes no claim', () => {
  it('renders the mean but never selects a row that has no spread', () => {
    // row-2 has the LOWEST mean of all and no std at all. If the table placed
    // rows by mean alone it would win; the whole point is that it cannot.
    render(
      <FeatureCountSweepTable
        runs={[row('row-2', 2, 0.01, null), ...LADDER]}
        seedRunId="seed-run-0000"
        seedMethod="impurity"
        distinctLabelledValues={32}
      />,
    )

    const two = cellsOf('2').join(' ')
    expect(two).toMatch(/0\.0100/)
    expect(two).toMatch(/no spread/)
    expect(two).not.toMatch(/selected by the rule/)
    expect(two).not.toMatch(/lowest mean/)
    // The rule still ran on the rows that CAN be ordered.
    expect(cellsOf('4').join(' ')).toMatch(/selected by the rule/)
  })
})

describe('FeatureCountSweepTable — V43, one seed for every row', () => {
  /**
   * The seed and its method are read off the SWEEP, never off each row's own
   * importance. That is what makes the second case below possible at all: a
   * row whose algorithm records no importance (mlp, grp, hgb, a non-linear
   * svm) has nothing of its own to name, and a per-row lookup would render
   * either nothing or a different seed per row — the "different four features
   * per model" failure this feature's own detail calls out.
   */
  it('names ONE seed run and ONE method for the whole table', () => {
    render(
      <FeatureCountSweepTable
        runs={LADDER}
        seedRunId="seed-run-0000"
        seedMethod="impurity"
        distinctLabelledValues={32}
      />,
    )

    const named = screen.getAllByText(/taken from run seed-run/i)
    expect(named).toHaveLength(1)
    expect(named[0]).toHaveTextContent(/measured by impurity/i)
    // AC66's provisional clause — the ranking is not presented as settled.
    expect(named[0]).toHaveTextContent(/provisional under its own method/i)
    // AC69 — the population is stated along with what it already chose.
    expect(named[0]).toHaveTextContent(
      /hyperparameters were chosen against its test-split score/i,
    )
  })

  it('still names that one seed when a row own algorithm records no importance', () => {
    render(
      <FeatureCountSweepTable
        runs={[
          ...LADDER,
          // grp records no importance under any method T09 ships.
          row('row-6', 6, 0.054, 0.002, {
            algorithm: 'grp',
            featureImportanceKey: null,
          }),
        ]}
        seedRunId="seed-run-0000"
        seedMethod="impurity"
        distinctLabelledValues={32}
      />,
    )

    expect(screen.getAllByText(/taken from run seed-run/i)).toHaveLength(1)
    // And that row is a full member of the curve, not dropped for lacking
    // an importance of its own.
    expect(cellsOf('6').join(' ')).toMatch(/0\.0540/)
  })
})

describe('FeatureCountSweepTable — the arithmetic columns', () => {
  it('carries observations per feature on the distinct labelled count (AC68)', () => {
    render(
      <FeatureCountSweepTable
        runs={[row('row-7', 7, 0.0522, 0.002)]}
        seedRunId="seed-run-0000"
        seedMethod="impurity"
        distinctLabelledValues={32}
      />,
    )
    // 32 / 7 = 4.6 — the figure that tells a reader the top row is
    // interpolating rather than generalising.
    expect(cellsOf('7').join(' ')).toMatch(/4\.6/)
  })

  it('keeps an unfinished row in the curve, saying what it is doing instead', () => {
    render(
      <FeatureCountSweepTable
        runs={[
          row('row-4', 4, 0.0526, 0.003),
          cvRun({ id: 'row-6', status: 'RUNNING', metrics: null }),
        ]}
        seedRunId="seed-run-0000"
        seedMethod="impurity"
        distinctLabelledValues={32}
      />,
    )
    expect(screen.getByText(/still running/i)).toBeInTheDocument()
  })
})

function seedRun(overrides: Partial<DraftRunSummary> = {}): DraftRunSummary {
  return {
    id: 'seed-run-0000',
    status: 'SUCCEEDED',
    algorithm: 'random_forest',
    targetY: 'LAB-01',
    failureReason: null,
    cvFoldsKey: null,
    predictionsKey: 'predictions.parquet',
    holdoutPredictionsKey: null,
    scoringContainerId: null,
    holdoutMetrics: null,
    cvFolds: null,
    featureImportance: {
      algorithm: 'random_forest',
      method: 'impurity',
      standardized: null,
      scaling_methods: [],
      features: [
        { name: 'TI-101', importance: 0.5 },
        { name: 'PI-201', importance: 0.3 },
        { name: 'FI-301', importance: 0.2 },
      ],
    },
    splitStats: null,
    sweepId: null,
    sweepSeedRunId: null,
    goldArtifactId: 'art-1',
    datasetId: 'ds-1',
    ...overrides,
  }
}

describe('FeatureCountSweepLauncher — the cost is priced before the click', () => {
  it('states rows x folds = fits beside the button, not after launching', () => {
    render(
      <FeatureCountSweepLauncher
        draftId="draft-1"
        run={seedRun()}
        distinctLabelledValues={32}
        distinctLabelledLoading={false}
        distinctLabelledReason={null}
        onLaunched={vi.fn()}
      />,
    )
    // 3 features => counts 1,2,3 survive the plan; 32 distinct values => k=3.
    expect(screen.getByText(/3 rows × 3 folds = 9 fits/i)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Sweep 3 feature counts/i }),
    ).toBeEnabled()
  })
})

/**
 * The three states a first pass rendered as one. Collapsing them made the
 * control read "not recorded" on ~82 percent of runs, because a candidate-job
 * run freezes no splitStats BY DESIGN — this feature's own finding 20.
 */
describe('FeatureCountSweepLauncher — three distinct refusals, not one', () => {
  it('says it is still checking while the distinct count is in flight', () => {
    render(
      <FeatureCountSweepLauncher
        draftId="draft-1"
        run={seedRun()}
        distinctLabelledValues={null}
        distinctLabelledLoading={true}
        distinctLabelledReason={null}
        onLaunched={vi.fn()}
      />,
    )
    expect(
      screen.getByText(/checking how many distinct labelled values/i),
    ).toBeInTheDocument()
  })

  it('quotes the lookup failure verbatim rather than calling it missing', () => {
    render(
      <FeatureCountSweepLauncher
        draftId="draft-1"
        run={seedRun()}
        distinctLabelledValues={null}
        distinctLabelledLoading={false}
        distinctLabelledReason="Artifact not found"
        onLaunched={vi.fn()}
      />,
    )
    expect(screen.getByText(/Artifact not found/)).toBeInTheDocument()
  })

  it('names the actual count when it is genuinely too small for two folds', () => {
    render(
      <FeatureCountSweepLauncher
        draftId="draft-1"
        run={seedRun()}
        distinctLabelledValues={12}
        distinctLabelledLoading={false}
        distinctLabelledReason={null}
        onLaunched={vi.fn()}
      />,
    )
    expect(
      screen.getByText(/12 distinct labelled values is too few/i),
    ).toBeInTheDocument()
  })

  it('refuses when the seed ranking orders by unit rather than influence', () => {
    render(
      <FeatureCountSweepLauncher
        draftId="draft-1"
        run={seedRun({
          featureImportance: {
            algorithm: 'ridge',
            method: 'coefficient',
            // Not standardized => canRank is false: the numbers rank by
            // unit, so a prefix taken from them cuts the wrong features.
            standardized: false,
            scaling_methods: [],
            features: [{ name: 'TI-101', importance: 0.5 }],
          },
        })}
        distinctLabelledValues={32}
        distinctLabelledLoading={false}
        distinctLabelledReason={null}
        onLaunched={vi.fn()}
      />,
    )
    expect(
      screen.getByText(/orders by unit rather than influence/i),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Sweep/i })).toBeNull()
  })

  /**
   * A SWEEP ROW CANNOT SEED A SWEEP. Its importance describes the truncated
   * column set it was GIVEN, not the ranking that chose it — seeding from one
   * would credit the ordering to the wrong fit, and would silently narrow the
   * candidate features so that "4 features" in the new ladder meant something
   * different from "4 features" in the old one.
   */
  it('refuses to seed a new sweep from a run that is itself a sweep row', () => {
    render(
      <FeatureCountSweepLauncher
        draftId="draft-1"
        run={seedRun({ sweepId: 'sweep-1', sweepSeedRunId: 'seed-run-0000' })}
        distinctLabelledValues={32}
        distinctLabelledLoading={false}
        distinctLabelledReason={null}
        onLaunched={vi.fn()}
      />,
    )
    expect(
      screen.getByText(/this run is itself one row of a sweep/i),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Sweep/i })).toBeNull()
  })

  it('refuses an algorithm the trainer cannot fit on an explicit column list', () => {
    render(
      <FeatureCountSweepLauncher
        draftId="draft-1"
        run={seedRun({ algorithm: 'lstm' })}
        distinctLabelledValues={32}
        distinctLabelledLoading={false}
        distinctLabelledReason={null}
        onLaunched={vi.fn()}
      />,
    )
    expect(
      screen.getByText(/lstm is not one of the algorithms/i),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Sweep/i })).toBeNull()
  })
})

/**
 * `launchFeatureCountSweep` STOPS at the first row that fails to create,
 * deliberately, so a curve never carries a silent gap. That makes a short
 * ladder a first-class state the panel has to report — otherwise three rows
 * from a seven-row plan read as a complete curve.
 */
describe('FeatureCountSweepLauncher — what the launch actually reports', () => {
  const launcher = (onLaunched = vi.fn()) => {
    render(
      <FeatureCountSweepLauncher
        draftId="draft-1"
        run={seedRun()}
        distinctLabelledValues={32}
        distinctLabelledLoading={false}
        distinctLabelledReason={null}
        onLaunched={onLaunched}
      />,
    )
    return onLaunched
  }

  it('says how many of the planned rows actually launched', async () => {
    mockLaunch.mockResolvedValue(['run-a', 'run-b'])
    const onLaunched = launcher()

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /Sweep 3 feature counts/i }))

    expect(await screen.findByText(/Launched 2 of 3 rows/i)).toBeInTheDocument()
    // The curve is still shown — two rows is a reading, just an incomplete
    // one — so the sweep id is still handed up.
    expect(onLaunched).toHaveBeenCalledTimes(1)
  })

  it('reports a launch that produced no rows, and shows no curve for it', async () => {
    mockLaunch.mockResolvedValue([])
    const onLaunched = launcher()

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /Sweep 3 feature counts/i }))

    expect(await screen.findByText(/No rows launched/i)).toBeInTheDocument()
    expect(onLaunched).not.toHaveBeenCalled()
  })

  it('surfaces the failure verbatim when the launch throws', async () => {
    mockLaunch.mockRejectedValue(new Error('artifact is still materialising'))
    const onLaunched = launcher()

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: /Sweep 3 feature counts/i }))

    expect(
      await screen.findByText(/artifact is still materialising/i),
    ).toBeInTheDocument()
    expect(onLaunched).not.toHaveBeenCalled()
  })
})
