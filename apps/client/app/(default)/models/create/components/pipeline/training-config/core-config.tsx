'use client'

import { useState } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
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

      {/* Train / Test Split — presets + Custom */}
      <TrainTestSplit
        trainTestSplit={trainTestSplit}
        onSplitChange={onSplitChange}
      />

      <SeedControl
        seed={seed}
        onSeedChange={onSeedChange}
        algorithms={algorithms}
      />
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
