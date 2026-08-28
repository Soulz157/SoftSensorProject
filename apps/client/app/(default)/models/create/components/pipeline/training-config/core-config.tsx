'use client'

import { useState } from 'react'
import { Label } from '@/components/ui/label'
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
import { TargetVariableSelector } from './tag-variable-select'

interface Props {
  tags: string[]
  targetVariables: string[]
  onTargetChange: (tag: string[]) => void
  lossFunction: string
  onLossChange: (loss: string) => void
  trainTestSplit: number
  onSplitChange: (split: number) => void
}

export function CoreConfig({
  tags,
  targetVariables,
  onTargetChange,
  lossFunction,
  onLossChange,
  trainTestSplit,
  onSplitChange,
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
