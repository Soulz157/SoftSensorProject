'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAtomValue } from 'jotai'
import { Eye, RotateCcw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  preprocess,
  toChartRows,
  type FillStrategy,
  type FillStrategyConfig,
} from '@/lib/preprocessing'
import { precleanse } from '@/lib/precleanse'
import { tagMeta } from '@/lib/mock-readings'
import {
  mpRawDatasetAtom,
  mpTimeRangeAtom,
  mpFillStrategiesAtom,
  PERIOD_TO_RANGE,
} from '@/store/model-pipeline'
import { SegmentedToggle } from '@/app/(default)/data-visualize/components/segmented-toggle'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'
import { RawTrendChart } from '../../chart/raw-data-chart'
import { ProcessingActionFooter } from './processing-action-footer'

const STRATEGY_OPTIONS: { value: FillStrategy; label: string }[] = [
  { value: 'drop', label: 'Drop row' },
  { value: 'forward', label: 'Forward fill' },
  { value: 'backward', label: 'Backward fill' },
  { value: 'mean', label: 'Mean' },
  { value: 'median', label: 'Median' },
  { value: 'constant', label: 'Constant' },
]

const DEBOUNCE_MS = 300

type Preview = 'raw' | 'cleaned'

interface Props {
  nav: UsePipelineNavResult
}

/**
 * Sub-step 5.2 — Data Imputation. Per-tag fill strategy for the Bad/Questionable
 * readings left after 5.1 pre-cleansing. Operates on the pre-cleansed dataset
 * (`precleanse(raw, cfg)`), so crop + outlier removal from 5.1 flow through.
 * Next (Start Training) advances Phase 5 → 6 once ≥1 row survives.
 */
export function Step52Imputation({ nav }: Props) {
  const raw = useAtomValue(mpRawDatasetAtom)
  const period = useAtomValue(mpTimeRangeAtom)
  const strategies = useAtomValue(mpFillStrategiesAtom)
  const { cropRange, conditionalRules, statisticalRules } = nav

  // Pre-cleansed dataset (5.1 output) is the source for imputation.
  const base = useMemo(
    () =>
      precleanse(raw, {
        crop: cropRange,
        conditional: conditionalRules,
        statistical: statisticalRules,
      }),
    [raw, cropRange, conditionalRules, statisticalRules],
  )

  const [draft, setDraft] =
    useState<Record<string, FillStrategyConfig>>(strategies)
  const [preview, setPreview] = useState<Preview>('cleaned')

  // Commit drafts through the nav setter so Training/Results relock on change.
  const { setFillStrategies } = nav
  useEffect(() => {
    const timer = setTimeout(() => setFillStrategies(draft), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [draft, setFillStrategies])

  const preprocessed = useMemo(
    () => preprocess(base, strategies),
    [base, strategies],
  )
  const allDropped = base.rows.length > 0 && preprocessed.rows.length === 0

  const setTagStrategy = (tag: string, strategy: FillStrategy) => {
    setDraft(prev => ({
      ...prev,
      [tag]: { strategy, constantValue: prev[tag]?.constantValue },
    }))
  }
  const setTagConstant = (tag: string, value: number) => {
    setDraft(prev => ({
      ...prev,
      [tag]: { strategy: 'constant', constantValue: value },
    }))
  }
  const reset = () => setDraft({})

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Choose how to fill Bad/Questionable readings per tag.
        </p>
        <Button size="sm" variant="ghost" onClick={reset}>
          <RotateCcw className="h-3.5 w-3.5" />
          Reset to defaults
        </Button>
      </div>

      <div className="space-y-2">
        {base.tags.map(tag => {
          const config = draft[tag]
          const label = tagMeta(tag)?.label ?? tag
          return (
            <div
              key={tag}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"
            >
              <div className="min-w-32 flex-1">
                <p className="font-mono text-sm">{tag}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
              <Select
                value={config?.strategy ?? 'drop'}
                onValueChange={v => setTagStrategy(tag, v as FillStrategy)}
              >
                <SelectTrigger className="h-9 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STRATEGY_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {config?.strategy === 'constant' && (
                <Input
                  type="number"
                  className="h-9 w-28"
                  placeholder="Value"
                  value={config.constantValue ?? ''}
                  onChange={e => {
                    const n = Number(e.target.value)
                    if (!Number.isNaN(n)) setTagConstant(tag, n)
                  }}
                />
              )}
            </div>
          )
        })}
      </div>

      {allDropped && (
        <Alert variant="destructive">
          <AlertTitle>This rule removed every row</AlertTitle>
          <AlertDescription>
            Try a fill strategy instead of Drop.
          </AlertDescription>
        </Alert>
      )}

      {/* Before / after preview */}
      <div className="flex items-center justify-between border-t border-border/60 pt-4">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Eye className="h-3.5 w-3.5" />
          Show result after processing
        </div>
        <SegmentedToggle
          ariaLabel="Preview dataset"
          value={preview}
          onChange={setPreview}
          options={[
            { value: 'raw', label: 'Pre-cleansed' },
            { value: 'cleaned', label: 'Imputed' },
          ]}
        />
      </div>

      <RawTrendChart
        rows={toChartRows(preview === 'raw' ? base : preprocessed)}
        tags={(preview === 'raw' ? base : preprocessed).tags}
        range={PERIOD_TO_RANGE[period]}
      />

      <ProcessingActionFooter
        backLabel="Back to Preprocessing"
        nextLabel="Start Training"
        onBack={() => nav.setProcessingSubStep(1)}
        onNext={nav.next}
        nextDisabled={preprocessed.rows.length === 0}
      />
    </div>
  )
}
