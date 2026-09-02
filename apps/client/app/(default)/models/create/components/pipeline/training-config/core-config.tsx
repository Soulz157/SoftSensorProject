'use client'

import { useEffect, useState } from 'react'
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
import { LOSS_OPTIONS } from '@/lib/training-config'
import { seedConsumedBy } from '@/lib/run-params'
import { useArtifactHoldout } from '@/hooks/dataset/artifact/use-artifact-holdout'
import { ALGORITHM_LABELS, type Algorithm } from '@/store/model-pipeline'
import { TargetVariableSelector } from './tag-variable-select'

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
  /** MODEL-FLOW-016-T10. `undefined` means Cross-Validation is off. */
  nSplits: number | undefined
  onNSplitsChange: (nSplits: number | undefined) => void
  /** Sweep mutual exclusion (userDecisions: CV × algorithm sweep is
   * mutually exclusive, disabled with a stated reason — same discipline
   * lstm/gru already follows in this wizard). */
  findBestModel: boolean
  datasetId: string | null
  artifactId: string | null
  hasArtifact: boolean
  /**
   * MODEL-FLOW-016-T10. Fetched by the PARENT (`Phase3TrainingConfig`),
   * not here — see `SplitDistributionPanel`'s own `splitStats` doc comment
   * for why: a call here duplicated the request AND, since this prop is
   * fed from the DRAFT trainTestSplit rather than the committed one,
   * would have refetched on every ratio-slider drag, defeating the Apply
   * boundary this whole feature commits `n_splits` inside.
   */
  maxAdmissibleK: number | null
  splitStatsLoading: boolean
}

export function CoreConfig({
  tags,
  targetVariables,
  onTargetChange,
  lossFunction,
  onLossChange,
  trainTestSplit,
  onSplitChange,
  seed,
  onSeedChange,
  algorithms,
  nSplits,
  onNSplitsChange,
  findBestModel,
  datasetId,
  artifactId,
  hasArtifact,
  maxAdmissibleK,
  splitStatsLoading,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        </div>

        {/* Loss Function */}
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
          {/* MODEL-FLOW-012: recorded on the saved model, not sent to the
              trainer — see LOSS_OPTIONS' own doc comment. */}
          <p className="text-[11px] text-muted-foreground">
            Recorded on the saved model. Not sent to the trainer — the
            estimator&apos;s own objective is used.
          </p>
        </div>
      </div>

      {/* Train / Test Split — presets + Custom. Ignored, not hidden, when
          CV is on: the run's own splitSpec is one or the other, and hiding
          this control would leave no record of what it WOULD have been. */}
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

      <CvControl
        datasetId={datasetId}
        artifactId={artifactId}
        hasArtifact={hasArtifact}
        algorithms={algorithms}
        findBestModel={findBestModel}
        nSplits={nSplits}
        onNSplitsChange={onNSplitsChange}
        maxAdmissibleK={maxAdmissibleK}
        splitStatsLoading={splitStatsLoading}
      />

      {/* <SeedControl
        seed={seed}
        onSeedChange={onSeedChange}
        algorithms={algorithms}
      /> */}
    </div>
  )
}

/** Bounds match CreateTrainingRunSchema.seed (model-run.authorized.dto.ts) —
 * the DTO the client actually hits when launching a single run. */
const SEED_MIN = 1
const SEED_MAX = 2147483646

/**
 * MODEL-FLOW-014-T07. Exposes the estimator seed — already generated and
 * recorded server-side on every run (model-run-launch.authorized.service.ts
 * `dto.seed ?? randomInt(...)`) — as an optional control. Copy states BOTH
 * halves of what it does: the estimator's own randomness, never the
 * train/test boundary, which is chronological regardless of this value.
 * Per-algorithm truth via `seedConsumedBy`, not a blanket claim — the same
 * annotate-don't-hide pattern MODEL-FLOW-012-T05 set for Loss function.
 */
function SeedControl({
  seed,
  onSeedChange,
  algorithms,
}: {
  seed: number | undefined
  onSeedChange: (seed: number | undefined) => void
  algorithms: Algorithm[]
}) {
  const ignoring = algorithms.filter(a => !seedConsumedBy(a))

  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium" htmlFor="model-seed">
        Seed{' '}
        <span className="font-normal text-muted-foreground">(optional)</span>
      </Label>
      <Input
        id="model-seed"
        type="number"
        inputMode="numeric"
        min={SEED_MIN}
        max={SEED_MAX}
        step={1}
        placeholder="auto — server generates one per run"
        value={seed ?? ''}
        onChange={e => {
          const raw = e.target.value
          if (raw === '') {
            onSeedChange(undefined)
            return
          }
          const parsed = Number(raw)
          if (!Number.isFinite(parsed)) return
          const clamped = Math.min(
            SEED_MAX,
            Math.max(SEED_MIN, Math.round(parsed)),
          )
          onSeedChange(clamped)
        }}
        className="h-9 text-sm"
      />
      <p className="text-[11px] text-muted-foreground">
        Controls the estimator&apos;s own randomness — bootstrap sampling,
        weight initialization, feature subsampling. Does{' '}
        <span className="font-medium text-foreground">not</span> control the
        train/test boundary: the split is always chronological, so the last rows
        by time are the test set regardless of this value.
      </p>
      {ignoring.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Ignored by {ignoring.map(a => ALGORITHM_LABELS[a]).join(', ')} — this
          estimator has no source of randomness a seed could fix.
        </p>
      )}
    </div>
  )
}

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
/** T01(c): CV is TABULAR ONLY — lstm/gru cut on WINDOW count via
 *  chronological_split_windows, a fold rule this feature does not
 *  implement. Mirrors SplitDistributionPanel's own `hasSequenceAlgorithm`
 *  check exactly — the same disable reason, in the same place a training
 *  run's own config-time refusal fires (model-run-launch.authorized.
 *  service.ts). */
function hasSequenceAlgorithm(algorithms: Algorithm[]): boolean {
  return algorithms.some(a => a === 'lstm' || a === 'gru')
}

interface CvControlProps {
  datasetId: string | null
  artifactId: string | null
  hasArtifact: boolean
  algorithms: Algorithm[]
  findBestModel: boolean
  nSplits: number | undefined
  onNSplitsChange: (nSplits: number | undefined) => void
  /** Fetched by the parent — see `Props.maxAdmissibleK`'s own doc comment. */
  maxAdmissibleK: number | null
  splitStatsLoading: boolean
}

/**
 * MODEL-FLOW-016-T10. The enable toggle + `n_splits`, committed on Apply
 * like every other Core Config field — a live `n_splits` would refetch the
 * fold plan on every keystroke, which is the reason `useRunConfigDraft`'s
 * Apply boundary (MODEL-FLOW-014-T08) exists in the first place.
 *
 * DISABLE WITH A STATED REASON, never silently, in four cases (T01(c) adds
 * a fourth beyond this task's own three): the algorithm is lstm/gru; Find
 * Best Model (a sweep) is on; the dataset has no validation holdout — a CV
 * run's only prediction series comes from holdout scoring, so with none the
 * user would pay for k+1 fits and get nothing to ever score; and the
 * dataset cannot support two folds (`max_admissible_k < 2`). Same
 * disable+swapped-description pattern `ToggleRow` (automl-toggles.tsx)
 * already uses for Find Best Parameters — one vocabulary, three
 * precedents (lstm/gru, Find Best Parameters, Evaluation's "Compare
 * with…"), not a fourth invented here.
 */
function CvControl({
  datasetId,
  artifactId,
  hasArtifact,
  algorithms,
  findBestModel,
  nSplits,
  onNSplitsChange,
  maxAdmissibleK,
  splitStatsLoading,
}: CvControlProps) {
  const isSequence = hasSequenceAlgorithm(algorithms)

  const {
    holdout,
    loading: holdoutLoading,
    missing: holdoutMissing,
  } = useArtifactHoldout(
    hasArtifact ? datasetId : null,
    hasArtifact ? artifactId : null,
  )

  // A reclaimed holdout's BYTES are gone, but its DB record (and therefore
  // eligibility) is not — the same distinction the server's own
  // `findHoldoutArtifact` draws (it checks `validationRowCount`, never
  // object existence). Only a CONFIRMED absence (holdout === null, with
  // neither a fetch in flight nor a reclaimed-sidecar 404) disables here.
  const hasHoldout = holdout !== null || holdoutMissing

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

  // Defense in depth, not the primary path: the Switch's own `disabled`
  // prop already stops a NEW enable while ineligible. This covers the
  // draft edit that makes an ALREADY-on CV ineligible mid-edit (algorithm
  // changed to lstm, Find Best Model turned on) — without it the toggle
  // would sit checked-and-disabled, and Start Training would only find out
  // from the server's own refusal (buildRunData's own lstm/gru or sweep
  // guard) at Apply time instead of here, immediately.
  useEffect(() => {
    if (disabled && checked) onNSplitsChange(undefined)
  }, [disabled, checked, onNSplitsChange])

  // The default (5) or a value picked before `max_admissible_k` finished
  // loading can exceed the cap once it arrives — clamp the STORED value,
  // not just the Slider's own visual max, so what Start Training sends
  // matches what the thumb shows.
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
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium">Folds (k)</Label>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {nSplits}
              {maxAdmissibleK !== null && ` (max ${maxAdmissibleK})`}
            </span>
          </div>
          <Slider
            min={N_SPLITS_MIN}
            max={Math.max(
              N_SPLITS_MIN,
              Math.min(N_SPLITS_MAX, maxAdmissibleK ?? N_SPLITS_MAX),
            )}
            step={1}
            value={[nSplits ?? N_SPLITS_DEFAULT]}
            onValueChange={vals => {
              const next = vals[0]
              if (next !== undefined) onNSplitsChange(next)
            }}
          />
        </div>
      )}
    </div>
  )
}
