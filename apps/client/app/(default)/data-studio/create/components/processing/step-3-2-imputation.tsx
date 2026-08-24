'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { RotateCcw, Save } from 'lucide-react'
import { toast } from 'sonner'
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
  dwHighestUnlockedAtom,
  dwSdtaPresetsAtom,
  dwPresetRangeAtom,
  dwPresetRangeStaleAtom,
  dwTagUnitsAtom,
  dwTargetTagAtom,
} from '@/store/dataset-studio'
import { useImputationTagList } from '@/hooks/dataset/use-imputation-tag-list'
import { useDatasetTagSelection } from '@/hooks/dataset/use-dataset-tag-selection'
import { useDatasetDraftPipeline } from '@/hooks/dataset/use-dataset-draft-pipeline'
import { ImputationDetailPanel } from './imputation/imputation-detail-panel'
import { CleaningTagBadges } from './imputation/cleaning-tag-badges'
import { ProcessingActionFooter } from './processing-action-footer'
import { UseDatasetPipelineNavResult } from '@/hooks/dataset/use-dataset-pipeline-nav'
import { CutOffSection } from '../cutoff-section'
import { datasetHealth } from '@/lib/feature-preset'
import { SdtaPresetCard } from '../sdta-preset-card'

interface Props {
  nav: UseDatasetPipelineNavResult
}

/** Deep-ish equality for two pipelines (stable JSON of their steps). */
function pipelineEq(a: TagPipeline, b: TagPipeline): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function Step32Imputation({ nav }: Props) {
  const raw = useAtomValue(dwRawDatasetAtom)
  const period = useAtomValue(dwTimeRangeAtom)
  const range = PERIOD_TO_RANGE[period]

  const {
    cropRange,
    valueCrop,
    valueClip,
    exclusions,
    conditionalRules,
    statisticalRules,
    cleaningTags,
    setCleaningTags,
    cleaningPipelines,
    cleanedTags,
    saveCleanedTags,
  } = nav

  const breakdown = useMemo(
    () =>
      precleanseBreakdown(raw, {
        crop: cropRange,
        valueCrop,
        valueClip,
        exclusions,
        conditional: conditionalRules,
        statistical: statisticalRules,
      }),
    [
      raw,
      cropRange,
      valueCrop,
      valueClip,
      exclusions,
      conditionalRules,
      statisticalRules,
    ],
  )
  const base = breakdown.dataset

  const cropped = base

  useDatasetTagSelection(base)

  const setHighestUnlocked = useSetAtom(dwHighestUnlockedAtom)
  const relock = () => setHighestUnlocked(prev => Math.min(prev, 4))

  const [draft, setDraft] = useState<CleaningStep[]>([])
  const [previewTags, setPreviewTags] = useState<string[]>([])
  const [previewIndex, setPreviewIndex] = useState(0)
  const [rawIsolated, setRawIsolated] = useState('')

  // Re-seed the draft from the batch's saved pipeline only when a FRESH batch
  // starts (0 → N selected). Growing/shrinking an in-progress batch keeps the
  // draft so the user doesn't lose work mid-edit.
  const prevCountRef = useRef(0)
  useEffect(() => {
    const prev = prevCountRef.current
    prevCountRef.current = cleaningTags.length
    if (cleaningTags.length === 0) {
      setDraft([])
      return
    }
    if (prev === 0) {
      setDraft(cleaningPipelines[cleaningTags[0] ?? ''] ?? [])
    }
  }, [cleaningTags, cleaningPipelines])

  const isolatedTag = cleaningTags.includes(rawIsolated)
    ? rawIsolated
    : (cleaningTags[0] ?? '')
  // Keep the preview within the current batch. Default to ALL selected tags so
  // the chart mirrors the sidebar selection on entry; prune to still-selected
  // on change, and re-seed to the full set when the pruned result is empty.
  useEffect(() => {
    setPreviewTags(prev => {
      const pruned = prev.filter(t => cleaningTags.includes(t))
      return pruned.length > 0 ? pruned : [...cleaningTags]
    })
  }, [cleaningTags])

  const draftMap = useMemo(() => {
    const map: Record<string, TagPipeline> = {}
    for (const tag of cleaningTags) map[tag] = draft
    return map
  }, [cleaningTags, draft])

  const { rows } = useImputationTagList(base, draftMap)
  const isolatedQuality = rows.find(r => r.tag === isolatedTag)?.quality

  const dirty = cleaningTags.some(
    t => !pipelineEq(cleaningPipelines[t] ?? [], draft),
  )
  const cleanedSet = useMemo(() => new Set(cleanedTags), [cleanedTags])
  const allCleaned =
    cleaningTags.length > 0 && cleaningTags.every(t => cleanedSet.has(t))
  const canSave = cleaningTags.length > 0 && (dirty || !allCleaned)

  const {
    syncState,
    applyClean,
    cancel,
    retry,
    finalPreview,
    requestFinalPreview,
  } = useDatasetDraftPipeline()

  const presets = useAtomValue(dwSdtaPresetsAtom)
  const presetRangeCandidates = useAtomValue(dwPresetRangeAtom)
  const presetRangeStale = useAtomValue(dwPresetRangeStaleAtom)
  const tagUnits = useAtomValue(dwTagUnitsAtom)
  const targetTag = useAtomValue(dwTargetTagAtom)

  const health = useMemo(() => datasetHealth(raw.tags), [raw.tags])

  const handleSave = () => {
    if (cleaningTags.length === 0) return
    saveCleanedTags(cleaningTags, draft)
    // DS-LAKE-012-T01 fix: `applyClean` silently no-ops when `draft` is empty
    // (use-dataset-draft-pipeline.ts) — no job is started, no SILVER artifact
    // is ever produced. The toast must say so rather than claiming "Cleaned",
    // which previously fired unconditionally and was indistinguishable from a
    // real server-synced clean. Marking tags clean with an empty pipeline is
    // still a legitimate action (accept raw), just not a cleaning one.
    const count = cleaningTags.length
    const plural = count === 1 ? '' : 's'
    toast.success(
      draft.length === 0
        ? `Marked ${count} tag${plural} as clean (no cleaning step added)`
        : `Cleaned ${count} tag${plural}`,
    )
    // "Local preview, server on Apply": the toast above and every control on
    // this page are the SAME as before this hook existed — this call only
    // adds a real SILVER artifact behind the save. A failure lands in
    // `syncState`, not in a dialog, so it cannot block the local flow that
    // already happened above. Skipped entirely when `draft` is empty — there
    // is no cleaning pipeline to sync, and `applyClean` would no-op anyway.
    if (draft.length > 0) void applyClean(cleaningTags, draft)
  }
  const preprocessed = useMemo(
    () => preprocessPipelines(base, cleaningPipelines).rows.length,
    [base, cleaningPipelines],
  )

  const allDropped = base.rows.length > 0 && preprocessed === 0
  // Step-by-step preview for the isolated tag: apply only the first
  // `previewIndex` draft steps so the scrubber shows each stage's effect live.
  const previewRows = useMemo(() => {
    const truncated = draft.slice(0, previewIndex)
    const processed = preprocessPipelines(
      base,
      isolatedTag ? { [isolatedTag]: truncated } : {},
    )
    return tagFillPreview(base, processed, isolatedTag)
  }, [base, draft, previewIndex, isolatedTag])

  // T01 hybrid: a server-verified preview fires ONLY when the scrubber is
  // sitting on the final step (every draft step applied) — every intermediate
  // scrub position stays purely local (`previewRows` above), unchanged. Any
  // other scrubber position resets to idle so a stale server preview can
  // never be shown next to a local preview of an earlier step.
  useEffect(() => {
    const atFinalStep =
      previewIndex === draft.length &&
      draft.length > 0 &&
      cleaningTags.length > 0
    if (atFinalStep) {
      requestFinalPreview(cleaningTags, draft)
    } else {
      requestFinalPreview([], [])
    }
  }, [previewIndex, draft, cleaningTags, requestFinalPreview])

  // Live full-draft dataset (all selected tags) for the Cut Off section, so
  // cropping always operates on the filled data.
  const processedDataset = useMemo(
    () => preprocessPipelines(base, draftMap),
    [base, draftMap],
  )

  const removeCleaningTag = (tag: string) =>
    setCleaningTags(cleaningTags.filter(t => t !== tag))
  const updateDraft = (next: CleaningStep[]) => {
    setDraft(next)
    relock()
  }
  const reset = () => updateDraft([])

  return (
    <div className="space-y-4">
      <h3>Step 3.2: Data Cleaning</h3>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Select tags in the sidebar, build a cleaning pipeline, then save the
          batch. Saved tags are marked Cleaned.
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={reset}
            disabled={draft.length === 0}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset pipeline
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!canSave}>
            <Save className="h-3.5 w-3.5" />
            Save Cleaned Tags
          </Button>
        </div>
      </div>

      {/* Server sync status — read-only, never gates Save. The interactive
          panel's preview stays local; this just reports whether the last
          saved batch also produced a SILVER artifact server-side. Cancel and
          Retry only appear for the state they apply to — neither is a new
          control on the ALWAYS-visible surface (DS-LAKE-005-T04). */}
      {syncState.status !== 'idle' && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <p>
            {syncState.status === 'syncing' &&
              'Syncing cleaned data to the server…'}
            {syncState.status === 'synced' && 'Synced to the server.'}
            {syncState.status === 'error' &&
              `Server sync failed: ${syncState.error ?? 'unknown error'}`}
          </p>
          {syncState.status === 'syncing' && (
            <Button size="sm" variant="ghost" onClick={() => void cancel()}>
              Cancel sync
            </Button>
          )}
          {syncState.status === 'error' && (
            <Button size="sm" variant="ghost" onClick={() => void retry()}>
              Retry sync
            </Button>
          )}
        </div>
      )}

      <CleaningTagBadges tags={cleaningTags} onRemove={removeCleaningTag} />

      <div className="relative">
        <div className="min-w-0 space-y-4">
          <SdtaPresetCard
            presets={presets}
            health={health}
            exclusions={exclusions}
            conditionalRules={conditionalRules}
            onExclusionsChange={next => {
              nav.setExclusions(next)
              relock()
            }}
            onConditionalChange={next => {
              nav.setConditionalRules(next)
              relock()
            }}
          />
          {cleaningTags.length > 0 ? (
            <div className="space-y-4">
              {dirty && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Unsaved changes — click Save Cleaned Tags to apply this
                  pipeline to the {cleaningTags.length} selected tag
                  {cleaningTags.length === 1 ? '' : 's'}.
                </p>
              )}

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

              {/* T01 hybrid: server-verified check, ONLY visible when the
                  scrubber is on the final step. The chart above stays purely
                  local at every position — this is a supplementary number,
                  never a replacement for it. */}
              {finalPreview.status !== 'idle' && (
                <p className="text-xs text-muted-foreground">
                  {finalPreview.status === 'loading' &&
                    'Verifying the final pipeline against the server…'}
                  {finalPreview.status === 'error' &&
                    `Server verification failed: ${finalPreview.error ?? 'unknown error'}`}
                  {finalPreview.status === 'ready' && finalPreview.data && (
                    <>
                      Server-verified: {finalPreview.data.before.row_count} →{' '}
                      {finalPreview.data.after.row_count} rows,{' '}
                      {finalPreview.data.before.missing_pct.toFixed(1)}% →{' '}
                      {finalPreview.data.after.missing_pct.toFixed(1)}% missing.
                      {finalPreview.data.warnings.length > 0 &&
                        ` ${finalPreview.data.warnings.join(' ')}`}
                    </>
                  )}
                </p>
              )}

              <CutOffSection
                raw={raw}
                precleansed={processedDataset}
                range={range}
                cropRange={cropRange}
                onCropChange={nav.setCropRange}
                valueCrop={valueCrop}
                valueClip={nav.valueClip}
                previewTags={previewTags}
                onPreviewTagsChange={setPreviewTags}
                onValueCropChange={nav.setValueCrop}
                onValueClipChange={nav.setValueClip}
                exclusions={exclusions}
                onExcludeRange={excl =>
                  nav.setExclusions([...exclusions, excl])
                }
                onClearExclusions={() => nav.setExclusions([])}
                scopeTag={isolatedTag}
                breakdown={breakdown}
                croppedDataset={cropped}
                conditionalRules={conditionalRules}
                statisticalRules={statisticalRules}
                onConditionalChange={nav.setConditionalRules}
                onStatisticalChange={nav.setStatisticalRules}
                presetRangeCandidates={presetRangeCandidates}
                presetRangeStale={presetRangeStale}
                tagUnits={tagUnits}
                targetTag={targetTag}
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
        nextDisabled={preprocessed === 0}
      />
    </div>
  )
}
