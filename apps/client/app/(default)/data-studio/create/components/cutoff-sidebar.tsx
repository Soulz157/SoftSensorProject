'use client'

import {
  PanelTopClose,
  PanelTopOpenIcon,
  SlidersHorizontal,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { Dataset } from '@/lib/preprocessing'
import type {
  ConditionalRule,
  CropRange,
  PrecleanseRemoved,
  StatisticalRule,
} from '@/lib/precleanse'
import { CutoffSummary } from './cutoff-summary'
import { OutlierRemovalPanel } from './outlier-removal-panel'

interface Props {
  isOpen: boolean
  onToggle: () => void
  // Cut-off summary
  removed: PrecleanseRemoved
  keptRows: number
  totalRows: number
  // Outlier / condition rules
  tags: string[]
  previewDataset: Dataset
  // Time crop (keep range) — shared with the crop slider
  rawTimestamps: string[]
  cropRange: CropRange
  onCropChange: (range: CropRange) => void
  conditionalRules: ConditionalRule[]
  statisticalRules: StatisticalRule[]
  onConditionalChange: (rules: ConditionalRule[]) => void
  onStatisticalChange: (rules: StatisticalRule[]) => void
  scopeTag?: string
}

export function CutoffSidebar({
  isOpen,
  onToggle,
  removed,
  keptRows,
  totalRows,
  tags,
  previewDataset,
  rawTimestamps,
  cropRange,
  onCropChange,
  conditionalRules,
  statisticalRules,
  onConditionalChange,
  onStatisticalChange,
  scopeTag,
}: Props) {
  if (!isOpen) {
    return (
      <div className="lg:sticky lg:top-6 lg:self-start">
        <Button
          variant="outline"
          size="icon"
          onClick={onToggle}
          aria-label="Expand cut-off panel"
          className="h-9 w-9"
        >
          <PanelTopOpenIcon className="h-4 w-4" />
        </Button>
      </div>
    )
  }

  return (
    <aside className={cn('w-full space-y-3 border-t border-border/60 pt-4')}>
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">
          Outlier Removal
        </h3>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-7 w-7"
          onClick={onToggle}
          aria-label="Collapse cut-off panel"
        >
          <PanelTopClose className="h-4 w-4" />
        </Button>
      </div>

      <CutoffSummary
        removed={removed}
        keptRows={keptRows}
        totalRows={totalRows}
      />

      <ScrollArea className="h-130 rounded-xl border border-border">
        <div className="p-3">
          <OutlierRemovalPanel
            tags={tags}
            previewDataset={previewDataset}
            rawTimestamps={rawTimestamps}
            cropRange={cropRange}
            onCropChange={onCropChange}
            conditionalRules={conditionalRules}
            statisticalRules={statisticalRules}
            onConditionalChange={onConditionalChange}
            onStatisticalChange={onStatisticalChange}
            scopeTag={scopeTag}
          />
        </div>
      </ScrollArea>
    </aside>
  )
}
