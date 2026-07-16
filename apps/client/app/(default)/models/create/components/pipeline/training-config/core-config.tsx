'use client'

import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { LOSS_OPTIONS } from '@/lib/training-config'

interface Props {
  tags: string[]
  targetVariable: string
  onTargetChange: (tag: string) => void
  lossFunction: string
  onLossChange: (loss: string) => void
  trainTestSplit: number
  onSplitChange: (split: number) => void
}

/**
 * Core training inputs: target variable (required), loss function, and the
 * visual Train/Test split. The split slider reports the live 80/20 breakdown in
 * mono, mirroring the fine-tune hyperparameter pattern.
 */
export function CoreConfig({
  tags,
  targetVariable,
  onTargetChange,
  lossFunction,
  onLossChange,
  trainTestSplit,
  onSplitChange,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">
            Target variable <span className="text-destructive">*</span>
          </Label>
          <Select value={targetVariable} onValueChange={onTargetChange}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="Select a tag to predict" />
            </SelectTrigger>
            <SelectContent>
              {tags.map(tag => (
                <SelectItem key={tag} value={tag}>
                  {tag}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

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
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">Train / Test split</Label>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            Train {trainTestSplit}% · Test {100 - trainTestSplit}%
          </span>
        </div>
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
      </div>
    </div>
  )
}
