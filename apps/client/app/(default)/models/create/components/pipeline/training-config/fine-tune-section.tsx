'use client'

import { SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  ALGORITHM_LABELS,
  type Algorithm,
  type HyperparamValue,
} from '@/store/model-pipeline'
import type { UseFineTuneResult } from '@/hooks/model/use-fine-tune'
import type { FineTuneChoice } from '@/lib/fine-tune'
import type { DatasetSize } from '@/lib/hyperparam-ranges'
import { isAlgorithm } from '@/lib/model-draft-hydration'
import { METRIC_META } from '@/lib/model-metrics'
import {
  runHeadlineOf,
  SCORE_METRIC_LABELS,
  type ScoreMetric,
} from '@/lib/run-params'
import { formatCvScore } from './cv-results-section'
import { DynamicHyperparameters } from './dynamic-hyperparameters'
import { VariantPreview } from './variant-preview'

interface Props {
  fineTune: UseFineTuneResult
  /** Applied CV k, for the Find Best Parameters description. */
  nSplits: number | undefined
  datasetSize: DatasetSize
}

/**
 * MODEL-FLOW-035 — Round 2, as a panel inside Algorithm & hyperparameters.
 * Its switch decides what Step 3's single Start button does: off, train every
 * algorithm above once; on, a hyperparameter search over the model picked
 * here. The model is picked the way Round 1's algorithms are shown — one card
 * per trained algorithm, the best by the Loss function preselected — and the
 * open card carries the same hyperparameter fields, starting at that run's
 * values, so the fine-tune's starting point can be adjusted before the
 * curated variants (Find Best Parameters) and/or the added rows are tried.
 * The state lives in `useFineTune`, shared with the button.
 *
 * Nothing here launches or writes a Model; Save Model stays the only final
 * commit.
 */
export function FineTuneSection({ fineTune, nSplits, datasetSize }: Props) {
  const {
    available,
    enabled,
    setEnabled,
    metric,
    choices,
    defaultRunId,
    source,
    setSourceRunId,
    setBaseValue,
    tunable,
    algorithm,
    base,
    useGrid,
    setUseGrid,
  } = fineTune
  const open = enabled && source !== null

  return (
    <div
      aria-label="Fine-tune"
      role="group"
      className="space-y-3 rounded-lg border border-border p-3"
    >
      <div className="flex items-start gap-3">
        <SlidersHorizontal className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <Label htmlFor="fine-tune-enabled" className="text-sm font-medium">
            Fine-tune
          </Label>
          <p className="text-xs text-muted-foreground">
            {!available
              ? 'Available once a training run succeeds — train the algorithms above first.'
              : open
                ? `Start Training tunes the model picked below — the best by ${SCORE_METRIC_LABELS[metric]} is preselected.`
                : 'Off: Start Training trains every algorithm above once. Turn on to tune one model.'}
          </p>
        </div>
        <Switch
          id="fine-tune-enabled"
          checked={open}
          disabled={!available}
          onCheckedChange={setEnabled}
        />
      </div>

      {open && source && (
        <div className="space-y-3 border-t border-border/60 pt-3">
          <div className="space-y-1.5">
            <Label id="fine-tune-model-label" className="text-xs font-medium">
              Model to fine-tune
            </Label>
            <ul
              role="radiogroup"
              aria-labelledby="fine-tune-model-label"
              className="space-y-1.5"
            >
              {choices.map(choice => (
                <ChoiceCard
                  key={choice.algorithm}
                  choice={choice}
                  metric={metric}
                  selected={choice.run.id === source.id}
                  best={choice.run.id === defaultRunId}
                  onSelect={() => setSourceRunId(choice.run.id)}
                  hyperparameters={base}
                  onChange={setBaseValue}
                  datasetSize={datasetSize}
                />
              ))}
            </ul>
          </div>

          <div className="flex items-start gap-3 rounded-lg border border-border p-3">
            <div className="min-w-0 flex-1">
              <Label htmlFor="fine-tune-grid" className="text-sm font-medium">
                Find Best Parameters
              </Label>
              <p className="text-xs text-muted-foreground">
                Also try a curated set of hyperparameter variants for{' '}
                {ALGORITHM_LABELS[algorithm]}
                {nSplits !== undefined
                  ? ' — every variant is cross-validated (k+1 fits each) and the lowest mean CV score wins'
                  : ''}
                . Off: only the values above and the rows you add below.
              </p>
            </div>
            <Switch
              id="fine-tune-grid"
              checked={useGrid}
              onCheckedChange={setUseGrid}
            />
          </div>

          {tunable && (
            <VariantPreview
              key={source.id}
              algorithm={algorithm}
              base={base}
              size={datasetSize}
              mode={useGrid ? 'direct' : 'manual'}
            />
          )}
        </div>
      )}
    </div>
  )
}

/**
 * One trained algorithm, styled like Round 1's algorithm card. Picking it
 * tunes its best run; once picked it opens on that run's hyperparameters,
 * editable as on Round 1's card.
 */
function ChoiceCard({
  choice,
  metric,
  selected,
  best,
  onSelect,
  hyperparameters,
  onChange,
  datasetSize,
}: {
  choice: FineTuneChoice
  metric: ScoreMetric
  selected: boolean
  best: boolean
  onSelect: () => void
  /** The fine-tune's starting values — read only while `selected`. */
  hyperparameters: Record<string, HyperparamValue>
  onChange: (key: string, value: HyperparamValue) => void
  datasetSize: DatasetSize
}) {
  const label =
    ALGORITHM_LABELS[choice.algorithm as Algorithm] ?? choice.algorithm
  const head = runHeadlineOf(choice.run, metric)
  const tunable = isAlgorithm(choice.algorithm)
  const panelId = `fine-tune-params-${choice.algorithm}`

  return (
    <li
      className={cn(
        'rounded-md border transition-colors',
        selected ? 'border-primary/60 bg-primary/3' : 'border-border',
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        aria-controls={selected ? panelId : undefined}
        onClick={onSelect}
        className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span
          aria-hidden="true"
          className={cn(
            'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border',
            selected ? 'border-primary' : 'border-muted-foreground/50',
          )}
        >
          {selected && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
        </span>
        <span className="min-w-0 truncate text-sm font-medium text-foreground">
          {label}
        </span>
        {best && (
          <Badge
            variant="outline"
            className="h-4 shrink-0 px-1.5 text-[9px] font-medium"
            title={`Lowest ${SCORE_METRIC_LABELS[metric]} of the trained models.`}
          >
            best
          </Badge>
        )}
        {choice.runCount > 1 && (
          <span className="shrink-0 text-[10px] text-muted-foreground">
            best of {choice.runCount} runs
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-baseline gap-2 font-mono text-xs tabular-nums text-foreground">
          <span>
            <span className="mr-1 font-sans text-[9px] uppercase text-muted-foreground">
              {head.isCv ? 'cv ' : ''}
              {SCORE_METRIC_LABELS[metric]}
            </span>
            {formatCvScore(head.value, METRIC_META[metric].format)}
          </span>
          <span>
            <span className="mr-1 font-sans text-[9px] uppercase text-muted-foreground">
              {head.isCv ? 'cv ' : ''}R²
            </span>
            {formatCvScore(head.r2, METRIC_META.r2.format)}
          </span>
        </span>
      </button>

      {selected && (
        <div
          id={panelId}
          className="border-t border-border/60 px-3 pt-2.5 pb-3"
        >
          {tunable ? (
            <DynamicHyperparameters
              algorithm={choice.algorithm as Algorithm}
              hyperparameters={hyperparameters}
              onChange={onChange}
              size={datasetSize}
            />
          ) : (
            <p className="text-[11px] text-muted-foreground">
              {choice.algorithm} is no longer offered, so this model cannot be
              fine-tuned.
            </p>
          )}
        </div>
      )}
    </li>
  )
}
