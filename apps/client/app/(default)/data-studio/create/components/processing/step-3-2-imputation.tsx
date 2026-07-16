'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { RotateCcw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  preprocessPipelines,
  tagFillPreview,
  type CleaningStep,
  type TagPipeline,
} from '@/lib/preprocessing'
import { precleanse, precleanseBreakdown } from '@/lib/precleanse'
import { PERIOD_TO_RANGE } from '@/store/model-pipeline'
import {
  dwRawDatasetAtom,
  dwTimeRangeAtom,
  dwCleaningTagsAtom,
  dwCleaningPipelinesAtom,
  dwHighestUnlockedAtom,
} from '@/store/dataset-studio'
import { useImputationTagList } from '@/hooks/dataset/use-imputation-tag-list'
import { useDatasetTagSelection } from '@/hooks/dataset/use-dataset-tag-selection'
import { ImputationDetailPanel } from './imputation/imputation-detail-panel'
import { CleaningTagBadges } from './imputation/cleaning-tag-badges'
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
  const range = PERIOD_TO_RANGE[period]

  const {
    cropRange,
    valueCrop,
    conditionalRules,
    statisticalRules,
    cleaningTags,
    setCleaningTags,
    cleaningPipelines,
  } = nav

  const breakdown = useMemo(
    () =>
      precleanseBreakdown(raw, {
        crop: cropRange,
        valueCrop,
        conditional: conditionalRules,
        statistical: statisticalRules,
      }),
    [raw, cropRange, valueCrop, conditionalRules, statisticalRules],
  )
  const base = breakdown.dataset

  const cropped = useMemo(
    () =>
      precleanse(raw, {
        crop: cropRange,
        valueCrop,
        conditional: [],
        statistical: [],
      }),
    [raw, cropRange, valueCrop],
  )

  const { activeTags } = useDatasetTagSelection(base)

  // Default the cleaning-target set to every active tag on first entry. Written
  // straight to the atom (not via nav.setCleaningTags) so the auto-seed doesn't
  // relock later wizard steps — only genuine user edits should do that.
  const seedCleaningTags = useSetAtom(dwCleaningTagsAtom)
  // Raw pipeline setter + relock. The debounced fan-out below syncs the draft
  // to the atom WITHOUT relocking (so revisiting the step doesn't bump the user
  // back); genuine draft edits relock via `updateDraft`.
  const setCleaningPipelinesRaw = useSetAtom(dwCleaningPipelinesAtom)
  const setHighestUnlocked = useSetAtom(dwHighestUnlockedAtom)
  const relock = () => setHighestUnlocked(prev => Math.min(prev, 4))
  const seededRef = useRef(false)
  useEffect(() => {
    if (
      !seededRef.current &&
      cleaningTags.length === 0 &&
      activeTags.length > 0
    ) {
      seededRef.current = true
      seedCleaningTags(activeTags)
    }
  }, [cleaningTags.length, activeTags, seedCleaningTags])

  // One shared pipeline applies to every selected tag. Seed the editable draft
  // from the first selected tag's persisted pipeline.
  const persisted = cleaningTags.length
    ? (cleaningPipelines[cleaningTags[0] ?? ''] ?? [])
    : []
  const [draft, setDraft] = useState<CleaningStep[]>(persisted)
  const [previewIndex, setPreviewIndex] = useState(0)
  const [rawIsolated, setRawIsolated] = useState('')

  const isolatedTag = cleaningTags.includes(rawIsolated)
    ? rawIsolated
    : (cleaningTags[0] ?? '')

  // Debounced fan-out: the persisted pipelines mirror the selection exactly —
  // one shared draft for every selected tag, nothing for deselected tags (so a
  // removed tag is truly no longer cleaned). No relock here; see `relock` above.
  useEffect(() => {
    const timer = setTimeout(() => {
      const next: Record<string, TagPipeline> = {}
      for (const tag of cleaningTags) next[tag] = draft
      setCleaningPipelinesRaw(next)
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [draft, cleaningTags, setCleaningPipelinesRaw])

  const draftMap = useMemo(() => {
    const map: Record<string, TagPipeline> = {}
    for (const tag of cleaningTags) map[tag] = draft
    return map
  }, [cleaningTags, draft])
  const { rows } = useImputationTagList(base, draftMap)
  const isolatedQuality = rows.find(r => r.tag === isolatedTag)?.quality

  const truncated = useMemo(
    () => draft.slice(0, previewIndex),
    [draft, previewIndex],
  )
  const previewProcessed = useMemo(
    () =>
      preprocessPipelines(
        base,
        isolatedTag ? { [isolatedTag]: truncated } : {},
      ),
    [base, isolatedTag, truncated],
  )
  const previewRows = useMemo(
    () => tagFillPreview(base, previewProcessed, isolatedTag),
    [base, previewProcessed, isolatedTag],
  )

  // Committed result (from the persisted atom) drives the drop warning + gate.
  // Kept on the committed pipelines (not the live draft) so the gate doesn't
  // flicker on every keystroke in the Strategy Toolkit.
  const preprocessed = useMemo(
    () => preprocessPipelines(base, cleaningPipelines),
    [base, cleaningPipelines],
  )
  const allDropped = base.rows.length > 0 && preprocessed.rows.length === 0

  // Live, full-draft imputed dataset (all selected tags) — the single source of
  // truth the Cut Off section displays, so cropping always operates on the
  // filled data. Uses the live `draftMap` for instant propagation as the user
  // edits the Strategy Stack; memoized so the charts don't re-render needlessly.
  const processedDataset = useMemo(
    () => preprocessPipelines(base, draftMap),
    [base, draftMap],
  )

  const removeCleaningTag = (tag: string) =>
    setCleaningTags(cleaningTags.filter(t => t !== tag))
  // Editing the pipeline changes the produced dataset — relock downstream.
  const updateDraft = (next: CleaningStep[]) => {
    setDraft(next)
    relock()
  }
  const reset = () => updateDraft([])

  return (
    <div className="space-y-4">
      <h3>Step 3.2: Data Cleaning</h3>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Build a cleaning pipeline and apply it to every selected tag at once.
        </p>
        <Button size="sm" variant="ghost" onClick={reset}>
          <RotateCcw className="h-3.5 w-3.5" />
          Reset pipeline
        </Button>
      </div>

      <CleaningTagBadges tags={cleaningTags} onRemove={removeCleaningTag} />

      <div className="relative">
        <div className="min-w-0 space-y-4">
          {cleaningTags.length > 0 ? (
            <div className="space-y-4">
              <ImputationDetailPanel
                pipeline={draft}
                onPipelineChange={updateDraft}
                previewIndex={previewIndex}
                onPreviewIndexChange={setPreviewIndex}
                previewRows={previewRows}
                range={range}
                cleaningTags={cleaningTags}
                isolatedTag={isolatedTag}
                onIsolate={setRawIsolated}
                quality={isolatedQuality}
              />

              <CutOffSection
                raw={raw}
                precleansed={processedDataset}
                range={range}
                cropRange={cropRange}
                onCropChange={nav.setCropRange}
                valueCrop={valueCrop}
                onValueCropChange={nav.setValueCrop}
                scopeTag={isolatedTag}
                breakdown={breakdown}
                croppedDataset={cropped}
                conditionalRules={conditionalRules}
                statisticalRules={statisticalRules}
                onConditionalChange={nav.setConditionalRules}
                onStatisticalChange={nav.setStatisticalRules}
              />
            </div>
          ) : (
            <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
              Select one or more tags in the sidebar to start cleaning.
            </div>
          )}
        </div>
      </div>

      {allDropped && (
        <Alert variant="destructive">
          <AlertTitle>This pipeline removed every row</AlertTitle>
          <AlertDescription>
            Try a fill strategy instead of Drop Missing Rows.
          </AlertDescription>
        </Alert>
      )}

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
