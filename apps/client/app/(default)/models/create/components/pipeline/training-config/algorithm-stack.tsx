'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ALGORITHMS,
  ALGORITHM_LABELS,
  type Algorithm,
  type HyperparamValue,
} from '@/store/model-pipeline'
import { ineligibleReason } from '@/lib/algorithm-eligibility'
import { SEQUENCE_ALGORITHMS } from '@/lib/metric-source'
import type { DatasetSize } from '@/lib/hyperparam-ranges'
import { DynamicHyperparameters } from './dynamic-hyperparameters'

const MAX = 3

const DEFERRED_REASON: Partial<Record<Algorithm, string>> = {}

interface Props {
  algorithms: Algorithm[]
  onAlgorithmsChange: (algorithms: Algorithm[]) => void
  trainLabelledRows: number | null
  perAlgorithmHyperparameters: Partial<
    Record<Algorithm, Record<string, HyperparamValue>>
  >
  hyperparameters: Record<string, HyperparamValue>
  onHyperparameterChange: (
    algorithm: Algorithm,
    key: string,
    value: HyperparamValue,
  ) => void
  findBestParams: boolean
  findBestModel: boolean
  /**
   * MODEL-FLOW-024. The two size figures from the split stats Step 3 fetched;
   * sizes the suggested ranges under each field. Omitted (or unresolved) shows
   * the estimator's general ranges.
   */
  datasetSize?: DatasetSize
}

export function AlgorithmStack({
  algorithms,
  onAlgorithmsChange,
  trainLabelledRows,
  perAlgorithmHyperparameters,
  hyperparameters,
  onHyperparameterChange,
  findBestParams,
  findBestModel,
  datasetSize,
}: Props) {
  const atCap = algorithms.length >= MAX
  const onlyOne = algorithms.length <= 1

  const oversizedReason: Partial<Record<Algorithm, string>> =
    Object.fromEntries(
      ALGORITHMS.map(a => [a, ineligibleReason(a, trainLabelledRows)]).filter(
        (entry): entry is [Algorithm, string] => entry[1] !== null,
      ),
    )

  // MODEL-FLOW-024. lstm/gru train as a single run and, since this feature,
  // Find Best Parameters can tune one directly (one algorithm, no sweep — a
  // HYPERPARAMETER_SEARCH over `TUNING_GRID.lstm/.gru`). A SWEEP (Find Best
  // Model, with or without tuning) still refuses them. That is a scope
  // decision, not a backend limit: this comment used to say the candidate-job
  // service 400s a sequence-algorithm candidate outright, and it does not —
  // what 400ed a direct search was the empty tuning grid. A sweep would launch
  // up to three sequence fits before any tuning, and whether it should is an
  // open decision on MODEL-FLOW-024. Disabling the selection here, one layer
  // above `toBackendAlgorithm`'s backstop, means a user cannot select lstm,
  // turn on Find Best Model, and only discover the refusal at launch.
  const sequenceReason: Partial<Record<Algorithm, string>> = findBestModel
    ? Object.fromEntries(
        SEQUENCE_ALGORITHMS.map(a => [
          a,
          'Not available for Find Best Model — LSTM/GRU can be trained, or tuned with Find Best Parameters, one at a time.',
        ]),
      )
    : {}

  /**
   * Per-algorithm entry wins; the flat field answers for the PRIMARY only,
   * and only when there is no entry at all (`??`, so an entry the store
   * initialised to `{}` is respected as "untouched" rather than papered over
   * with the flat field's values). A non-primary algorithm never falls back
   * — the flat field was never about it.
   */
  const paramsFor = (a: Algorithm, index: number) =>
    perAlgorithmHyperparameters[a] ?? (index === 0 ? hyperparameters : {})

  const [expanded, setExpanded] = useState<Algorithm | null>(
    algorithms[0] ?? null,
  )

  // Render-time correction, not a `useEffect` — see the block comment above.
  if (expanded !== null && !algorithms.includes(expanded)) {
    setExpanded(algorithms[0] ?? null)
  }

  // MODEL-FLOW-022-T03. Self-correcting, same pattern `CvControl` already
  // uses for itself (core-config.tsx): a dataset change can make an
  // ALREADY-selected algorithm ineligible mid-edit. Folding its card is not
  // enough — the sweep would still launch a candidate for it and fail at
  // fit time, so it must leave the selection too, keeping at least one
  // algorithm selected. Defense in depth against a case the dropdown's own
  // `disabled` prop cannot cover, since it only stops a NEW selection.
  useEffect(() => {
    if (algorithms.length <= 1) return
    const stillEligible = algorithms.filter(a => !oversizedReason[a])
    if (
      stillEligible.length !== algorithms.length &&
      stillEligible.length > 0
    ) {
      onAlgorithmsChange(stillEligible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainLabelledRows])

  // [fix]. Same self-correcting shape, for the same reason, one mode
  // switch later: turning ON Find Best Model while lstm/gru is already
  // selected must drop it from the selection rather than wait for a
  // launch-time refusal — the dropdown's `disabled` above only stops a NEW
  // selection, not one made before the toggle flipped. Find Best Parameters
  // alone no longer does this (MODEL-FLOW-024): it can tune a sequence model.
  useEffect(() => {
    if (!findBestModel || algorithms.length <= 1) return
    const stillEligible = algorithms.filter(
      a => !SEQUENCE_ALGORITHMS.includes(a),
    )
    if (
      stillEligible.length !== algorithms.length &&
      stillEligible.length > 0
    ) {
      onAlgorithmsChange(stillEligible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findBestModel])

  const add = (a: Algorithm) => {
    if (atCap || algorithms.includes(a)) return
    onAlgorithmsChange([...algorithms, a])
    // Open the new card immediately. The user added it in order to tune it;
    // making them click again to reach the params is the tab flow's own
    // friction reappearing one interaction later.
    setExpanded(a)
  }

  const remove = (a: Algorithm) => {
    if (onlyOne) return // keep at least one; the button is disabled too
    const next = algorithms.filter(x => x !== a)
    onAlgorithmsChange(next)
    if (expanded === a) setExpanded(next[0] ?? null)
  }

  const addable = ALGORITHMS.filter(a => !algorithms.includes(a))

  return (
    <div className="space-y-2.5 rounded-lg border border-border p-3">
      <div className="space-y-1">
        <div className="flex items-baseline justify-between gap-3">
          <Label className="text-xs font-medium">Algorithms</Label>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {algorithms.length}/{MAX}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {onlyOne ? (
            'Trains one model. Add a second to compare algorithms in the same run.'
          ) : (
            <>
              Trains in the order below, one at a time — not together. Expect{' '}
              {algorithms.length} fits
              {findBestParams &&
                ", plus a curated set of hyperparameter variants tried against whichever algorithm wins (Find Best Parameters' phase 2, decided after phase 1 finishes)"}
              .
            </>
          )}
        </p>
      </div>

      <ul className="space-y-1.5">
        {algorithms.map((a, i) => (
          <AlgorithmCard
            key={a}
            algorithm={a}
            index={i}
            collapsible={!onlyOne}
            open={onlyOne || expanded === a}
            onToggle={() => setExpanded(prev => (prev === a ? null : a))}
            onRemove={() => remove(a)}
            removeDisabled={onlyOne}
            hyperparameters={paramsFor(a, i)}
            onChange={(key, value) => onHyperparameterChange(a, key, value)}
            datasetSize={datasetSize}
          />
        ))}
      </ul>

      <div className="space-y-1">
        {addable.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={atCap}
                className="h-7 w-full cursor-pointer gap-1 text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                Add algorithm
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel>Also train</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {addable.map(a => {
                // DEFERRED_REASON first: "the trainer cannot run this at
                // all" outranks "this dataset is too big for it" when both
                // apply. sequenceReason next: "not for this MODE" outranks
                // a dataset-size refusal too — both could apply to lstm/gru
                // on a large dataset, and the mode is what the user just
                // changed, so it is the more useful thing to say.
                const reason =
                  DEFERRED_REASON[a] ?? sequenceReason[a] ?? oversizedReason[a]
                return (
                  <DropdownMenuCheckboxItem
                    key={a}
                    checked={false}
                    disabled={Boolean(reason)}
                    onCheckedChange={() => add(a)}
                    className="cursor-pointer"
                  >
                    <span className="flex flex-col">
                      <span>{ALGORITHM_LABELS[a]}</span>
                      {reason && (
                        <span className="text-[10px] leading-snug whitespace-normal text-muted-foreground">
                          {reason}
                        </span>
                      )}
                    </span>
                  </DropdownMenuCheckboxItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {atCap && (
          <p className="text-[11px] text-muted-foreground">
            Up to {MAX} algorithms per run — remove one to swap.
          </p>
        )}
        {onlyOne && (
          <p className="text-[11px] text-muted-foreground">
            A run needs one algorithm, so this one can&apos;t be removed until a
            second is added.
          </p>
        )}
      </div>
    </div>
  )
}

function AlgorithmCard({
  algorithm,
  index,
  collapsible,
  open,
  onToggle,
  onRemove,
  removeDisabled,
  hyperparameters,
  onChange,
  datasetSize,
}: {
  algorithm: Algorithm
  index: number
  collapsible: boolean
  open: boolean
  onToggle: () => void
  onRemove: () => void
  removeDisabled: boolean
  hyperparameters: Record<string, HyperparamValue>
  onChange: (key: string, value: HyperparamValue) => void
  datasetSize: DatasetSize | undefined
}) {
  const label = ALGORITHM_LABELS[algorithm]
  const panelId = `algorithm-params-${algorithm}`
  const setCount = Object.keys(hyperparameters).length

  const summary = setCount === 0 ? 'defaults' : `${setCount} set`

  const heading = (
    <>
      <span className="w-3 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
        {index + 1}
      </span>
      <span
        className={cn(
          'truncate text-xs font-medium',
          collapsible && open && 'text-primary',
        )}
      >
        {label}
      </span>
      {collapsible && index === 0 && (
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">
          primary
        </span>
      )}
      {collapsible && !open && (
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {summary}
        </span>
      )}
    </>
  )

  return (
    <li
      className={cn(
        'rounded-md border transition-colors',
        collapsible && open
          ? 'border-primary/60 bg-primary/3'
          : 'border-border',
      )}
    >
      <div className="flex items-center gap-0.5 pr-1 pl-2">
        {collapsible ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={panelId}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {heading}
            <ChevronDown
              className={cn(
                'ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                open && 'rotate-180',
              )}
            />
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2 py-2">
            {heading}
          </div>
        )}

        <button
          type="button"
          onClick={onRemove}
          disabled={removeDisabled}
          aria-label={`Remove ${label} from this run`}
          className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-30"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {open && (
        <div
          id={panelId}
          className="border-t border-border/60 px-3 pt-2.5 pb-3"
        >
          <DynamicHyperparameters
            algorithm={algorithm}
            hyperparameters={hyperparameters}
            onChange={onChange}
            size={datasetSize}
          />
        </div>
      )}
    </li>
  )
}
