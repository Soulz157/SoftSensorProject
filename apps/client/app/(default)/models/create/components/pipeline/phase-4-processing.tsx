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
  type FillStrategy,
  type FillStrategyConfig,
} from '@/lib/preprocessing'
import { tagMeta } from '@/lib/mock-readings'
import {
  mpRawDatasetAtom,
  mpTimeRangeAtom,
  mpFillStrategiesAtom,
  PERIOD_TO_RANGE,
} from '@/store/model-pipeline'
import { SegmentedToggle } from '@/app/(default)/data-visualize/components/segmented-toggle'
import { StepView } from '@/app/(default)/data-visualize/components/step-view'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'

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

export function Phase4Processing({ nav }: Props) {
  const raw = useAtomValue(mpRawDatasetAtom)
  const range = useAtomValue(mpTimeRangeAtom)
  const strategies = useAtomValue(mpFillStrategiesAtom)
  const [draft, setDraft] =
    useState<Record<string, FillStrategyConfig>>(strategies)
  const [preview, setPreview] = useState<Preview>('cleaned')

  // Commit drafts through the nav setter so Training/Results relock on change.
  // Depend on the stable callback — `nav` is a fresh object every render, so
  // listing it here would re-commit (and reset training) every 300ms.
  const { setFillStrategies } = nav
  useEffect(() => {
    const timer = setTimeout(() => setFillStrategies(draft), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [draft, setFillStrategies])

  const preprocessed = useMemo(
    () => preprocess(raw, strategies),
    [raw, strategies],
  )
  const allDropped = raw.rows.length > 0 && preprocessed.rows.length === 0

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
          Choose how to handle Bad/Questionable readings per tag.
        </p>
        <Button size="sm" variant="ghost" onClick={reset}>
          <RotateCcw className="h-3.5 w-3.5" />
          Reset to defaults
        </Button>
      </div>

      <div className="space-y-2">
        {raw.tags.map(tag => {
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
            { value: 'raw', label: 'Raw' },
            { value: 'cleaned', label: 'Cleaned' },
          ]}
        />
      </div>

      <StepView
        dataset={preview === 'raw' ? raw : preprocessed}
        range={PERIOD_TO_RANGE[range]}
        showQuality={preview === 'raw'}
        summary={
          preview === 'raw'
            ? `${raw.rows.length} raw rows`
            : `${preprocessed.rows.length} rows kept of ${raw.rows.length}`
        }
      />
    </div>
  )
}
