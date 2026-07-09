'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAtomValue } from 'jotai'
import { RotateCcw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  preprocess,
  tagFillPreview,
  type FillStrategy,
  type FillStrategyConfig,
} from '@/lib/preprocessing'
import { precleanse } from '@/lib/precleanse'
import { PERIOD_TO_RANGE } from '@/store/model-pipeline'
import {
  dwRawDatasetAtom,
  dwTimeRangeAtom,
  dwFillStrategiesAtom,
} from '@/store/dataset-studio'
import { useImputationTagList } from '@/hooks/dataset/use-imputation-tag-list'
import { ImputationTagList } from './imputation/imputation-tag-list'
import { ImputationDetailPanel } from './imputation/imputation-detail-panel'
import { ProcessingActionFooter } from './processing-action-footer'
import { UseDatasetPipelineNavResult } from '@/hooks/dataset/use-dataset-pipeline-nav'
import { CutOffSection } from '../cutoff-section'

const DEBOUNCE_MS = 300

interface Props {
  nav: UseDatasetPipelineNavResult
}

export function Step32Imputation({ nav }: Props) {
  const raw = useAtomValue(dwRawDatasetAtom)
  const period = useAtomValue(dwTimeRangeAtom)
  const strategies = useAtomValue(dwFillStrategiesAtom)
  const range = PERIOD_TO_RANGE[period]

  const { cropRange, conditionalRules, statisticalRules } = nav

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
  const [isTagListOpen, setIsTagListOpen] = useState(true)

  const { setFillStrategies } = nav
  useEffect(() => {
    const timer = setTimeout(() => setFillStrategies(draft), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [draft, setFillStrategies])

  const cropped = useMemo(
    () =>
      precleanse(raw, {
        crop: cropRange,
        conditional: [],
        statistical: [],
      }),
    [raw, cropRange],
  )

  const precleansed = useMemo(
    () =>
      precleanse(raw, {
        crop: cropRange,
        conditional: conditionalRules,
        statistical: statisticalRules,
      }),
    [raw, cropRange, conditionalRules, statisticalRules],
  )

  const preprocessed = useMemo(
    () => preprocess(base, strategies),
    [base, strategies],
  )
  const previewed = useMemo(() => preprocess(base, draft), [base, draft])
  const allDropped = base.rows.length > 0 && preprocessed.rows.length === 0

  const {
    rows,
    filteredRows,
    query,
    setQuery,
    selectedTag,
    setSelectedTag,
    isLastTag,
    selectNext,
  } = useImputationTagList(base, draft)

  const previewRows = useMemo(
    () => tagFillPreview(base, previewed, selectedTag ?? ''),
    [base, previewed, selectedTag],
  )

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

  const selectedQuality = rows.find(r => r.tag === selectedTag)?.quality

  return (
    <div className="space-y-4">
      <h3>Step 3.2: Data Cleaning</h3>
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Choose how to fill Bad/Questionable readings per tag.
        </p>
        <Button size="sm" variant="ghost" onClick={reset}>
          <RotateCcw className="h-3.5 w-3.5" />
          Reset to defaults
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr] lg:items-start">
        <ImputationTagList
          rows={filteredRows}
          selectedTag={selectedTag}
          query={query}
          onQueryChange={setQuery}
          onSelectTag={setSelectedTag}
          isOpen={isTagListOpen}
          onOpen={() => setIsTagListOpen(true)}
          onClose={() => setIsTagListOpen(false)}
        />
        {selectedQuality && selectedTag && (
          <ImputationDetailPanel
            tag={selectedTag}
            quality={selectedQuality}
            config={draft[selectedTag]}
            previewRows={previewRows}
            range={PERIOD_TO_RANGE[period]}
            onStrategyChange={strategy => setTagStrategy(selectedTag, strategy)}
            onConstantChange={value => setTagConstant(selectedTag, value)}
            onSaveNext={selectNext}
            isLastTag={isLastTag}
          />
        )}
      </div>

      {allDropped && (
        <Alert variant="destructive">
          <AlertTitle>This rule removed every row</AlertTitle>
          <AlertDescription>
            Try a fill strategy instead of Drop.
          </AlertDescription>
        </Alert>
      )}

      <CutOffSection
        raw={raw}
        precleansed={precleansed}
        cropped={cropped}
        range={range}
        cropRange={cropRange}
        onCropChange={nav.setCropRange}
        tags={raw.tags}
        conditionalRules={conditionalRules}
        statisticalRules={statisticalRules}
        onConditionalChange={nav.setConditionalRules}
        onStatisticalChange={nav.setStatisticalRules}
      />

      <ProcessingActionFooter
        backLabel="Back to Preprocessing"
        nextLabel="Continue"
        onBack={() => nav.setProcessingSubStep(1)}
        onNext={nav.next}
        nextDisabled={preprocessed.rows.length === 0}
      />
    </div>
  )
}
