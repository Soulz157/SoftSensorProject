'use client'

import { Fragment, useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LOSS_OPTIONS } from '@/lib/training-config'
import {
  canonicalise,
  criterionLabel,
  evaluateCriterion,
  isLegacyCriterion,
  lossAlignedMetric,
  offerablePairs,
  operandLabel,
  operatorSymbol,
  pairLabel,
  pairsEqual,
  type AcceptanceCriterion,
  type ComparisonCriterion,
  type ComparisonOperator,
  type ComparisonPair,
  type LegacyAcceptanceCriterion,
} from '@/lib/acceptance-criteria'
import type { SourcedMetrics } from '@/lib/metric-source'
import { useArtifactHoldout } from '@/hooks/dataset/artifact/use-artifact-holdout'
import { type Algorithm } from '@/store/model-pipeline'
import { TargetVariableSelector } from './tag-variable-select'
import { Button } from '@/components/ui/button'

interface Props {
  tags: string[]
  targetVariables: string[]
  onTargetChange: (tag: string[]) => void
  lossFunction: string
  onLossChange: (loss: string) => void
  trainTestSplit: number
  onSplitChange: (split: number) => void
  seed: number | undefined
  onSeedChange: (seed: number | undefined) => void
  algorithms: Algorithm[]
  nSplits: number | undefined
  onNSplitsChange: (nSplits: number | undefined) => void
  findBestModel: boolean
  datasetId: string | null
  artifactId: string | null
  hasArtifact: boolean
  maxAdmissibleK: number | null
  splitStatsLoading: boolean
  acceptanceCriteria: AcceptanceCriterion[]
  onAcceptanceCriteriaChange: (criteria: AcceptanceCriterion[]) => void
  currentRunMetrics: SourcedMetrics[] | null
}

export function CoreConfig({
  tags,
  targetVariables,
  onTargetChange,
  lossFunction,
  onLossChange,
  trainTestSplit,
  onSplitChange,
  // seed,
  // onSeedChange,
  algorithms,
  nSplits,
  onNSplitsChange,
  findBestModel,
  datasetId,
  artifactId,
  hasArtifact,
  maxAdmissibleK,
  splitStatsLoading,
  acceptanceCriteria,
  onAcceptanceCriteriaChange,
  currentRunMetrics,
}: Props) {
  const {
    holdout,
    loading: holdoutLoading,
    missing: holdoutMissing,
  } = useArtifactHoldout(
    hasArtifact ? datasetId : null,
    hasArtifact ? artifactId : null,
  )

  const hasHoldout = holdout !== null || holdoutMissing

  return (
    <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
      {/* Target Variables */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium">
          Target variable <span className="text-destructive">*</span>
        </Label>
        <TargetVariableSelector
          tags={tags}
          targetVariables={targetVariables}
          onTargetChange={onTargetChange}
          disabled={tags.length === 0}
        />
        <div className={nSplits !== undefined ? 'opacity-50' : undefined}>
          <TrainTestSplit
            trainTestSplit={trainTestSplit}
            onSplitChange={onSplitChange}
          />
          {nSplits !== undefined && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Ignored — Cross-Validation below controls the split instead.
            </p>
          )}
        </div>
      </div>

      {/* Loss function + the criteria judged in its terms. One column, not
      two sections: the acceptance metric is chosen in the same breath as
      the objective, and the old placement (below Cross-Validation) put a
      screen of split controls between two decisions a user makes
      together. */}
      <div className="space-y-3 grid grid-cols-1 gap-3 ">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Loss function</Label>
          <Select value={lossFunction} onValueChange={onLossChange}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOSS_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            Recorded on the saved model. Not sent to the trainer — the
            estimator&apos;s own objective is used.
          </p>
        </div>

        <AcceptanceCriteriaControl
          criteria={acceptanceCriteria}
          onChange={onAcceptanceCriteriaChange}
          hasHoldout={hasHoldout}
          holdoutLoading={holdoutLoading}
          lossFunction={lossFunction}
          currentRunMetrics={currentRunMetrics}
        />

        <CvControl
          hasHoldout={hasHoldout}
          holdoutLoading={holdoutLoading}
          algorithms={algorithms}
          findBestModel={findBestModel}
          nSplits={nSplits}
          onNSplitsChange={onNSplitsChange}
          maxAdmissibleK={maxAdmissibleK}
          splitStatsLoading={splitStatsLoading}
        />
      </div>

      {/* <SeedControl
        seed={seed}
        onSeedChange={onSeedChange}
        algorithms={algorithms}
      /> */}
    </div>
  )
}

// const SEED_MIN = 1
// const SEED_MAX = 2147483646

// function SeedControl({
//   seed,
//   onSeedChange,
//   algorithms,
// }: {
//   seed: number | undefined
//   onSeedChange: (seed: number | undefined) => void
//   algorithms: Algorithm[]
// }) {
//   const ignoring = algorithms.filter(a => !seedConsumedBy(a))

//   return (
//     <div className="space-y-1.5">
//       <Label className="text-xs font-medium" htmlFor="model-seed">
//         Seed{' '}
//         <span className="font-normal text-muted-foreground">(optional)</span>
//       </Label>
//       <Input
//         id="model-seed"
//         type="number"
//         inputMode="numeric"
//         min={SEED_MIN}
//         max={SEED_MAX}
//         step={1}
//         placeholder="auto — server generates one per run"
//         value={seed ?? ''}
//         onChange={e => {
//           const raw = e.target.value
//           if (raw === '') {
//             onSeedChange(undefined)
//             return
//           }
//           const parsed = Number(raw)
//           if (!Number.isFinite(parsed)) return
//           const clamped = Math.min(
//             SEED_MAX,
//             Math.max(SEED_MIN, Math.round(parsed)),
//           )
//           onSeedChange(clamped)
//         }}
//         className="h-9 text-sm"
//       />
//       <p className="text-[11px] text-muted-foreground">
//         Controls the estimator&apos;s own randomness — bootstrap sampling,
//         weight initialization, feature subsampling. Does{' '}
//         <span className="font-medium text-foreground">not</span> control the
//         train/test boundary: the split is always chronological, so the last rows
//         by time are the test set regardless of this value.
//       </p>
//       {ignoring.length > 0 && (
//         <p className="text-[11px] text-muted-foreground">
//           Ignored by {ignoring.map(a => ALGORITHM_LABELS[a]).join(', ')} — this
//           estimator has no source of randomness a seed could fix.
//         </p>
//       )}
//     </div>
//   )
// }

const SPLIT_PRESETS = [90, 80, 70, 60, 50] as const

function TrainTestSplit({
  trainTestSplit,
  onSplitChange,
}: {
  trainTestSplit: number
  onSplitChange: (split: number) => void
}) {
  const isPreset = (SPLIT_PRESETS as readonly number[]).includes(trainTestSplit)
  const [custom, setCustom] = useState(!isPreset)
  const value = custom ? 'custom' : String(trainTestSplit)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium">Train / Test split</Label>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          Train {trainTestSplit}% · Test {100 - trainTestSplit}%
        </span>
      </div>

      <ToggleGroup
        type="single"
        value={value}
        onValueChange={v => {
          if (!v) return
          if (v === 'custom') {
            setCustom(true)
            return
          }
          setCustom(false)
          onSplitChange(Number(v))
        }}
        className="flex flex-wrap justify-start gap-1.5"
      >
        {SPLIT_PRESETS.map(p => (
          <ToggleGroupItem
            key={p}
            value={String(p)}
            className="cursor-pointer h-8 rounded-md border border-border px-3 font-medium text-xs data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
          >
            {p}:{100 - p}
          </ToggleGroupItem>
        ))}
        <ToggleGroupItem
          value="custom"
          className="cursor-pointer h-8 rounded-md border border-border px-3 font-medium text-xs data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
        >
          Custom
        </ToggleGroupItem>
      </ToggleGroup>

      {custom && (
        <Slider
          min={50}
          max={95}
          step={5}
          value={[trainTestSplit]}
          onValueChange={vals => {
            const next = vals[0]
            if (next !== undefined) onSplitChange(next)
          }}
        />
      )}
    </div>
  )
}

const N_SPLITS_MIN = 3
const N_SPLITS_MAX = 10
const N_SPLITS_DEFAULT = 5

function hasSequenceAlgorithm(algorithms: Algorithm[]): boolean {
  return algorithms.some(a => a === 'lstm' || a === 'gru')
}

interface CvControlProps {
  hasHoldout: boolean
  holdoutLoading: boolean
  algorithms: Algorithm[]
  findBestModel: boolean
  nSplits: number | undefined
  onNSplitsChange: (nSplits: number | undefined) => void
  maxAdmissibleK: number | null
  splitStatsLoading: boolean
}

function CvControl({
  hasHoldout,
  holdoutLoading,
  algorithms,
  findBestModel,
  nSplits,
  onNSplitsChange,
  maxAdmissibleK,
  splitStatsLoading,
}: CvControlProps) {
  const isSequence = hasSequenceAlgorithm(algorithms)

  const effectiveMax = Math.max(
    N_SPLITS_MIN,
    Math.min(N_SPLITS_MAX, maxAdmissibleK ?? N_SPLITS_MAX),
  )
  const [kText, setKText] = useState(String(nSplits ?? N_SPLITS_DEFAULT))

  useEffect(() => {
    if (nSplits !== undefined) setKText(String(nSplits))
  }, [nSplits])

  const commitK = (raw: string) => {
    const n = Number(raw)
    if (raw.trim() === '' || !Number.isInteger(n)) return
    if (n < N_SPLITS_MIN || n > effectiveMax) return
    if (n !== nSplits) onNSplitsChange(n)
  }

  const normalizeK = () => {
    const n = Number(kText)
    const fallback = nSplits ?? N_SPLITS_DEFAULT
    const next =
      kText.trim() === '' || !Number.isInteger(n)
        ? fallback
        : Math.min(effectiveMax, Math.max(N_SPLITS_MIN, n))
    setKText(String(next))
    if (next !== nSplits) onNSplitsChange(next)
  }

  const checked = nSplits !== undefined

  let disabledReason: string | null = null
  if (isSequence) {
    disabledReason =
      'Not available for LSTM/GRU — they split by window, not by row.'
  } else if (findBestModel) {
    disabledReason = 'Turn off Find Best Model first — CV runs one algorithm.'
  } else if (!holdoutLoading && !hasHoldout) {
    disabledReason =
      "This dataset has no validation holdout, so a CV run's model could " +
      'never be scored — pick a holdout when saving the dataset first.'
  } else if (
    !splitStatsLoading &&
    maxAdmissibleK !== null &&
    maxAdmissibleK < 2
  ) {
    disabledReason =
      `Too few distinct labelled values to support even 2 folds ` +
      `(admits at most ${maxAdmissibleK}).`
  }

  const disabled = disabledReason !== null

  useEffect(() => {
    if (disabled && checked) onNSplitsChange(undefined)
  }, [disabled, checked, onNSplitsChange])

  useEffect(() => {
    if (
      checked &&
      nSplits !== undefined &&
      maxAdmissibleK !== null &&
      maxAdmissibleK >= N_SPLITS_MIN &&
      nSplits > maxAdmissibleK
    ) {
      onNSplitsChange(maxAdmissibleK)
    }
  }, [checked, nSplits, maxAdmissibleK, onNSplitsChange])

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Label htmlFor="cv-toggle" className="text-xs font-medium">
            Cross-Validation
          </Label>
          <p className="text-[11px] text-muted-foreground">
            {disabled
              ? disabledReason
              : 'k expanding time-ordered folds plus a refit, instead of ' +
                'one train/test cut — costs k+1 fits (a k=5 run fits 6 ' +
                'models) in exchange for a spread instead of a single ' +
                'number. Writes no predictions itself; score the saved ' +
                'model against the holdout afterward.'}
          </p>
        </div>
        <Switch
          id="cv-toggle"
          checked={checked}
          disabled={disabled}
          onCheckedChange={on =>
            onNSplitsChange(on ? N_SPLITS_DEFAULT : undefined)
          }
        />
      </div>

      {checked && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="cv-folds" className="text-xs font-medium">
              Folds (k)
            </Label>
            <Input
              id="cv-folds"
              type="number"
              inputMode="numeric"
              min={N_SPLITS_MIN}
              max={effectiveMax}
              step={1}
              value={kText}
              onChange={e => {
                setKText(e.target.value)
                commitK(e.target.value)
              }}
              onBlur={normalizeK}
              className="h-7 w-20 text-right font-mono text-xs tabular-nums"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            {N_SPLITS_MIN}–{effectiveMax} folds
            {maxAdmissibleK !== null &&
              maxAdmissibleK < N_SPLITS_MAX &&
              ` — capped at ${maxAdmissibleK} by the distinct labelled values in this dataset`}
            . A k={kText || N_SPLITS_DEFAULT} run fits{' '}
            {(Number(kText) || N_SPLITS_DEFAULT) + 1} models.
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * MODEL-FLOW-019-T12. A bare comparison — free operator, chosen operands,
 * no typed value. REVERSES T11's ratio-with-a-ceiling shape on the user's
 * own ground: no threshold is derivable from this system's data
 * (MODEL-FLOW-020-T03's own capacity ladder got three different orderings
 * of the same five settings). A pair is picked from `offerablePairs()`
 * (lib/acceptance-criteria.ts, itself derived — never hand-listed), and the
 * operator is a per-row `<`/`>` toggle with no numeric input anywhere.
 * Advisory only, committed on Apply like every other field in this file —
 * Step 4 marks candidates against these, never filters, hides, or blocks
 * on them (AC13). `Validate R² ≥ 0` is the one surviving number, and it is
 * a checkbox rather than a typed field (AC33).
 */
function AcceptanceCriteriaControl({
  criteria,
  onChange,
  hasHoldout,
  holdoutLoading,
  lossFunction,
  currentRunMetrics,
}: {
  criteria: AcceptanceCriterion[]
  onChange: (criteria: AcceptanceCriterion[]) => void
  hasHoldout: boolean
  holdoutLoading: boolean
  lossFunction: string
  currentRunMetrics: SourcedMetrics[] | null
}) {
  const noHoldout = !holdoutLoading && !hasHoldout

  const legacy = criteria.filter(
    isLegacyCriterion,
  ) as unknown as LegacyAcceptanceCriterion[]
  const current = criteria.filter(
    (c): c is AcceptanceCriterion => !isLegacyCriterion(c),
  )
  const comparisons = current.filter(
    (c): c is ComparisonCriterion => c.kind === 'comparison',
  )
  const r2Floor = current.find(c => c.kind === 'r2-floor')

  const allPairs = offerablePairs()
  const aligned = lossAlignedMetric(lossFunction)
  const sortedPairs = [...allPairs].sort((a, b) => {
    const rank = (p: ComparisonPair) =>
      aligned && p.left.metric === aligned ? 0 : 1
    return rank(a) - rank(b)
  })
  const addable = sortedPairs.filter(
    p => !comparisons.some(c => pairsEqual(c, p)),
  )

  const setComparison = (
    pair: ComparisonPair,
    operator: ComparisonOperator,
  ) => {
    const withoutThis = current.filter(
      c => !(c.kind === 'comparison' && pairsEqual(c, pair)),
    )
    onChange([
      ...withoutThis,
      canonicalise({
        kind: 'comparison',
        left: pair.left,
        operator,
        right: pair.right,
      }),
    ])
  }

  const removeComparison = (pair: ComparisonPair) => {
    onChange(
      current.filter(c => !(c.kind === 'comparison' && pairsEqual(c, pair))),
    )
  }

  const toggleR2Floor = (checked: boolean) => {
    const withoutFloor = current.filter(c => c.kind !== 'r2-floor')
    onChange(checked ? [...withoutFloor, { kind: 'r2-floor' }] : withoutFloor)
  }

  const clearLegacy = () => onChange(current)

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="space-y-1">
        <Label className="text-xs font-medium">
          Acceptance criteria{' '}
          <span className="font-normal text-muted-foreground">
            (optional, advisory)
          </span>
        </Label>
        <p className="text-[11px] text-muted-foreground">
          A comparison between two figures of the same run — no threshold to
          type, just which is bigger. Step 4 marks each candidate against these,
          but never hides, filters, or blocks on them.
          {noHoldout &&
            ' This dataset has no validation holdout, so a holdout-sourced comparison has no figure to judge a candidate against yet.'}
        </p>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={Boolean(r2Floor)}
          onChange={e => toggleR2Floor(e.target.checked)}
          className="h-3.5 w-3.5 cursor-pointer accent-foreground"
        />
        <span className="font-medium text-foreground">
          {criterionLabel({ kind: 'r2-floor' })}
        </span>
      </label>

      {comparisons.length > 0 && (
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 gap-y-1">
          {comparisons.map((criterion, i) => {
            const pair: ComparisonPair = criterion
            const involvesSd =
              pair.left.metric === 'sd' || pair.right.metric === 'sd'
            const evaluation =
              !involvesSd && currentRunMetrics
                ? evaluateCriterion(criterion, {
                    sourcedMetrics: currentRunMetrics,
                    residualSd: null,
                    holdoutAbsence: null,
                  })
                : null
            const preview = involvesSd
              ? "Current value shown per run in Step 4 — residual SD isn't fetched here."
              : !evaluation ||
                  evaluation.left.value === null ||
                  evaluation.right.value === null
                ? 'No run yet to compute a value from.'
                : `${operandLabel(pair.left)} ${evaluation.left.value.toFixed(2)} · ${operandLabel(pair.right)} ${evaluation.right.value.toFixed(2)} — ${evaluation.verdict === 'pass' ? 'holds today' : 'does not hold today'}`
            return (
              <Fragment key={`${pairLabel(pair)}-${i}`}>
                <span className="text-xs font-medium text-foreground">
                  {operandLabel(pair.left)}
                </span>
                <ToggleGroup
                  type="single"
                  value={criterion.operator}
                  onValueChange={v =>
                    v && setComparison(pair, v as ComparisonOperator)
                  }
                  className="h-8"
                >
                  <ToggleGroupItem value="lt" className="h-8 px-2 text-xs">
                    {operatorSymbol('lt')}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="gt" className="h-8 px-2 text-xs">
                    {operatorSymbol('gt')}
                  </ToggleGroupItem>
                </ToggleGroup>
                <span className="flex items-center gap-1 text-xs font-medium text-foreground">
                  {operandLabel(pair.right)}
                  <button
                    type="button"
                    onClick={() => removeComparison(pair)}
                    aria-label={`Remove ${pairLabel(pair)} criteria`}
                    className="cursor-pointer rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
                <p className="col-span-3 -mt-1 text-[10px] text-muted-foreground">
                  {preview}
                </p>
              </Fragment>
            )
          })}
        </div>
      )}

      {addable.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 cursor-pointer gap-1 text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              Add criteria
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-full">
            <DropdownMenuLabel>Also judge against</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {addable.map((pair, i) => (
              <DropdownMenuCheckboxItem
                key={`${pairLabel(pair)}-${i}`}
                checked={false}
                onCheckedChange={() => setComparison(pair, 'lt')}
                className="cursor-pointer"
              >
                {pairLabel(pair)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {legacy.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/60 px-2 py-1.5">
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            {legacy.length} threshold{legacy.length === 1 ? '' : 's'} set under
            a previous form {legacy.length === 1 ? 'is' : 'are'} no longer
            applied in Step 4.
          </p>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 shrink-0 cursor-pointer px-2 text-[10px]"
            onClick={clearLegacy}
          >
            Clear
          </Button>
        </div>
      )}
    </div>
  )
}
