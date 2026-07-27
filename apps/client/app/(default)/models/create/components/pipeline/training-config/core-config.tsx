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
import { ChevronsUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'

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
  const toggleTarget = (tag: string) => {
    const isSelected = targetVariables.includes(tag)

    if (isSelected) {
      onTargetChange(targetVariables.filter(target => target !== tag))
    } else {
      onTargetChange([...targetVariables, tag])
    }
  }

  const allSelected =
    tags.length > 0 && tags.every(tag => targetVariables.includes(tag))
  const toggleAll = () => onTargetChange(allSelected ? [] : [...tags])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Target Variables */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">
            Target variables <span className="text-destructive">*</span>
          </Label>

          <Dialog>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                className="h-9 w-full justify-between text-sm font-normal"
              >
                <span className="truncate">
                  {targetVariables.length === 0
                    ? 'Select tags to predict'
                    : targetVariables.length === 1
                      ? targetVariables[0]
                      : `${targetVariables.length} targets selected`}
                </span>

                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </DialogTrigger>

            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="font-medium text-foreground text-md">
                  Select target variables
                </DialogTitle>
              </DialogHeader>

              <Button
                variant="default"
                size="sm"
                onClick={toggleAll}
                className="w-fit gap-2  cursor-pointer dark:bg-muted/10"
              >
                Select All ({tags.length})
              </Button>

              <Separator className="my-2 h-px w-full bg-border" />

              <ScrollArea className="h-[60vh] w-full rounded-md border border-border p-2 bg-primary/5 dark:bg-primary/10">
                <div className="space-y-1">
                  {tags.map(tag => {
                    const checked = targetVariables.includes(tag)

                    return (
                      <label
                        key={tag}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleTarget(tag)}
                        />

                        <span className="truncate text-sm font-medium">
                          {tag}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </ScrollArea>
            </DialogContent>
          </Dialog>

          {/* Selected targets */}
          {targetVariables.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {targetVariables.map(tag => (
                <span
                  key={tag}
                  className="rounded-md bg-muted px-2 py-1 text-[11px]"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
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
            className="cursor-pointer h-8 rounded-md border border-border px-3 font-mono text-xs data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
          >
            {p}:{100 - p}
          </ToggleGroupItem>
        ))}
        <ToggleGroupItem
          value="custom"
          className="cursor-pointer h-8 rounded-md border border-border px-3 text-xs data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
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
