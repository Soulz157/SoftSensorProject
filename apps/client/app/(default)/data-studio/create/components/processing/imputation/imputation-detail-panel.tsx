'use client'

import { ArrowRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { tagSeverity, type TagQuality } from '@/lib/data-quality'
import { resolveTagMeta, type TimeRange } from '@/lib/mock-readings'
import type {
  FillStrategy,
  FillStrategyConfig,
  TagFillPreviewRow,
} from '@/lib/preprocessing'
import { ImputationMethodCards } from './imputation-method-cards'
import { ImputationTrendChart } from './imputation-trend-chart'
import { ImputationComparisonHistogram } from './imputation-comparison-histogram'

interface Props {
  tag: string
  quality: TagQuality
  config: FillStrategyConfig | undefined
  previewRows: TagFillPreviewRow[]
  range: TimeRange
  onStrategyChange: (strategy: FillStrategy) => void
  onConstantChange: (value: number) => void
  onSaveNext: () => void
  isLastTag: boolean
}

/** Right "detail" panel of the Step 5.2 master-detail layout — the active tag's full workspace. */
export function ImputationDetailPanel({
  tag,
  quality,
  config,
  previewRows,
  range,
  onStrategyChange,
  onConstantChange,
  onSaveNext,
  isLastTag,
}: Props) {
  const severity = tagSeverity(quality)
  const label = resolveTagMeta(tag).label
  const missingRows = quality.missing + quality.suspect

  const before = previewRows
    .filter(
      (r): r is TagFillPreviewRow & { before: number } => r.before !== null,
    )
    .map(r => r.before)
  const after = previewRows
    .filter((r): r is TagFillPreviewRow & { after: number } => r.after !== null)
    .map(r => r.after)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase">
            Selected Tag
          </span>
          <h2 className="font-mono text-lg font-bold text-foreground">{tag}</h2>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>

        <div className="flex items-center gap-2">
          <Badge
            variant={severity === 'missing' ? 'destructive' : 'outline'}
            className={cn(
              severity === 'suspect' &&
                'border-amber-500/30 text-amber-600 dark:text-amber-400',
              severity === 'clean' &&
                'border-emerald-500/30 text-emerald-600 dark:text-emerald-400',
            )}
          >
            {severity === 'clean'
              ? 'Clean'
              : `Missing values: ${missingRows} rows`}
          </Badge>
          <Button
            size="sm"
            onClick={onSaveNext}
            disabled={isLastTag}
            className="gap-1.5"
          >
            Save &amp; Next Tag
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">
          Cleaning Strategy
        </h3>
        <ImputationMethodCards
          value={config?.strategy ?? 'drop'}
          constantValue={config?.constantValue}
          onChange={onStrategyChange}
          onConstantChange={onConstantChange}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-1">
        <div className="rounded-xl border border-border p-4 lg:col-span-2">
          <ImputationTrendChart rows={previewRows} tag={tag} range={range} />
        </div>
        <div className="rounded-xl border border-border p-4 lg:col-span-1">
          <ImputationComparisonHistogram
            before={before}
            after={after}
            tag={tag}
          />
        </div>
      </div>
    </div>
  )
}
