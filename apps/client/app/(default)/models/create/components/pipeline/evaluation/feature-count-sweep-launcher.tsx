'use client'

import { useState } from 'react'
import { Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { canRank } from '@/lib/feature-importance'
import {
  DEFAULT_SWEEP_COUNTS,
  admissibleFolds,
  prefixesFromSeed,
} from '@/lib/feature-count-sweep'
import { launchFeatureCountSweep } from '@/hooks/model/use-feature-count-sweep'
import type { DraftRunSummary } from '@/hooks/model/use-draft-run-evaluation'
import type { CreateDraftRunInput } from '@/services/model-draft'
import { EmptyPanel } from './empty-panel'

/**
 * MODEL-FLOW-019-T31. Launches the feature-count ladder: one CV run per
 * feature count, all sharing a `sweepId`, all ranked by ONE seed run's
 * importance.
 *
 * THE COST IS PRICED BEFORE THE CLICK, NOT REPORTED AFTER IT. Each row is its
 * own sequential container spawn, so a 7-row ladder at k=3 is 21 fits. T31's
 * own detail is explicit that a grid whose cost was never priced must not be
 * launched, so the arithmetic sits in the copy beside the button.
 */

/** `CreateDraftRunInput.algorithm` is the 10 `build_model` implements, which
 *  is narrower than the run's own `algorithm: string`. Narrowed explicitly
 *  rather than cast.
 *
 *  Defensive, not a live path: `canRank` gates this panel, and the methods
 *  that produce a rankable importance (impurity, coefficient, pls- and
 *  standardized-coefficient) only exist on algorithms already inside this
 *  union — `lstm`/`gru`, the two catalogue entries outside it, record no
 *  importance at all (MODEL-FLOW-019-T09). */
const SWEEPABLE = [
  'ols',
  'ridge',
  'hist_gradient_boosting',
  'svm',
  'mlp',
  'grp',
  'pls',
  'random_forest',
  'lightgbm',
  'xgboost',
] as const

function sweepableAlgorithm(
  algorithm: string,
): CreateDraftRunInput['algorithm'] | null {
  return (SWEEPABLE as readonly string[]).includes(algorithm)
    ? (algorithm as CreateDraftRunInput['algorithm'])
    : null
}

export function FeatureCountSweepLauncher({
  draftId,
  run,
  distinctLabelledValues,
  distinctLabelledLoading,
  distinctLabelledReason,
  onLaunched,
}: {
  draftId: string | null
  run: DraftRunSummary
  distinctLabelledValues: number | null
  distinctLabelledLoading: boolean
  /** Verbatim reason the distinct-labelled lookup could not answer, or null —
   *  kept separate from "too few values" so the refusal can say which. */
  distinctLabelledReason: string | null
  onLaunched: (sweepId: string) => void
}) {
  // EVERY hook above EVERY early return. A previous pass put `if (!canRank)
  // return null` above a second hook, which was a rules-of-hooks violation the
  // moment that hook landed (this feature's own finding 20, point 1).
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [partial, setPartial] = useState<string | null>(null)

  const importance = run.featureImportance
  const algorithm = sweepableAlgorithm(run.algorithm)
  const folds = admissibleFolds(distinctLabelledValues)
  const plan =
    importance && canRank(importance)
      ? prefixesFromSeed(importance, DEFAULT_SWEEP_COUNTS)
      : []

  const handleLaunch = async () => {
    if (!draftId || !algorithm || folds === null || plan.length === 0) return
    setLaunching(true)
    setError(null)
    setPartial(null)
    try {
      const sweepId = crypto.randomUUID()
      const launched = await launchFeatureCountSweep(
        draftId,
        sweepId,
        run.id,
        plan,
        {
          goldArtifactId: run.goldArtifactId,
          targetY: run.targetY,
          algorithm,
          // Hyperparameters deliberately OMITTED, so every row takes the
          // same defaults. `DraftRunSummary` does not carry the seed run's
          // own values, and the property this ladder actually needs is that
          // rows are comparable to EACH OTHER — one setting held constant
          // across the curve — not that they match the seed. Sending the
          // seed's values to some rows and defaults to others is the only
          // outcome that would make the curve unreadable.
          nSplits: folds,
          // The same default `launchDraftRun` freezes against when
          // `splitStatsTags` is omitted, and the endpoint requires at least
          // one tag — so every row records a split figure of its own.
          splitStatsTags: [run.targetY],
        },
      )
      // `launchFeatureCountSweep` STOPS at the first row that fails to
      // create, deliberately, so a curve never has a silent gap. Say so:
      // a table of three rows from a seven-row plan otherwise reads as a
      // complete ladder.
      if (launched.length < plan.length) {
        setPartial(
          `Launched ${launched.length} of ${plan.length} rows — the ladder stopped early, so the curve below is incomplete.`,
        )
      }
      if (launched.length > 0) onLaunched(sweepId)
      else setError('No rows launched.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not launch the sweep.')
    } finally {
      setLaunching(false)
    }
  }

  if (!importance) return null

  /**
   * A SWEEP ROW CANNOT SEED A SWEEP. This run is already one rung of a ladder,
   * so its importance is its own fit over an ALREADY-TRUNCATED column set —
   * not the ranking that chose those columns. Seeding from it would credit the
   * ordering to the wrong fit, which is exactly what `sweepSeedRunId` exists
   * to prevent (see its doc comment on DraftRunSummary: "Not the current run:
   * each row records its OWN importance, which is not the ranking that chose
   * its columns"). It would also silently narrow the candidate features to
   * whatever this row kept, so every count in the new ladder would mean
   * something different from the same count in the old one.
   */
  if (run.sweepId !== null) {
    return (
      <EmptyPanel>
        Sweep the feature count: unavailable — this run is itself one row of a
        sweep, so its importance describes the features it was given rather than
        the ranking that chose them. Open the run that seeded this sweep to
        launch another.
      </EmptyPanel>
    )
  }

  if (!canRank(importance)) {
    return (
      <EmptyPanel>
        Sweep the feature count: unavailable — this run&apos;s importance is a{' '}
        {importance.method} over features that carry no recorded scaling, so it
        orders by unit rather than influence. A ladder built on that order would
        compare the wrong prefixes.
      </EmptyPanel>
    )
  }

  if (algorithm === null) {
    return (
      <EmptyPanel>
        Sweep the feature count: unavailable — {run.algorithm} is not one of the
        algorithms the trainer can fit on an explicit column list.
      </EmptyPanel>
    )
  }

  // Three states that a first pass rendered as one, and the collapse made the
  // control read "not recorded" on ~82 percent of runs (finding 20).
  if (folds === null) {
    return (
      <EmptyPanel>
        {distinctLabelledLoading
          ? 'Sweep the feature count: checking how many distinct labelled values sit behind this run…'
          : distinctLabelledReason
            ? `Sweep the feature count: unavailable — the distinct labelled count could not be read (${distinctLabelledReason}).`
            : `Sweep the feature count: unavailable — ${
                distinctLabelledValues === null
                  ? 'the number of distinct labelled values is not known for this run'
                  : `${distinctLabelledValues} distinct labelled values is too few for even 2 folds`
              }, so no fold count can be derived.`}
      </EmptyPanel>
    )
  }

  const fits = plan.length * folds

  return (
    <section className="space-y-3 rounded-xl border border-border/60 p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-foreground">
          Sweep the feature count
        </h3>
        <p className="text-xs text-muted-foreground">
          Trains one cross-validated run per feature count —{' '}
          {plan.map(p => p.n).join(', ')} — each on the top-ranked features from
          this run&apos;s own importance, so every row is the same ranking cut
          at a different depth. Cross-validation is what gives each row a
          spread; a ladder of bare means could not be read.
        </p>
        {/* Priced before the click, never after. */}
        <p className="text-xs text-muted-foreground">
          {plan.length} rows × {folds} folds = {fits} fits, run one at a time.
          Each is its own container spawn.
        </p>
      </div>

      <Button
        variant="outline"
        size="sm"
        disabled={launching || !draftId}
        onClick={handleLaunch}
      >
        <Layers className="h-4 w-4" />
        {launching ? 'Launching…' : `Sweep ${plan.length} feature counts`}
      </Button>

      {partial && <p className="text-xs text-muted-foreground">{partial}</p>}
      {error && (
        <p className="text-xs text-muted-foreground">
          Could not launch the sweep — {error}
        </p>
      )}
    </section>
  )
}
