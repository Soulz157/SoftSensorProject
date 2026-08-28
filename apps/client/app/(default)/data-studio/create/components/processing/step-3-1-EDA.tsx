'use client'

import { useCallback, useMemo } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { precleanse, precleanseBounded } from '@/lib/precleanse'
import { describeAnalysisReadiness } from '@/lib/dataset-readiness'
import { PERIOD_TO_RANGE } from '@/store/model-pipeline'
import {
  dwBronzeWarmStateAtom,
  dwDraftArtifactIdAtom,
  dwEditingDatasetAtom,
  dwFeaturePresetAtom,
  dwFeaturePreviewSampleAtom,
  dwFeaturePreviewSampleStateAtom,
  dwFetchRequiredAtom,
  dwPresetRangeAtom,
  dwPresetRangeStaleAtom,
  dwRawDatasetAtom,
  dwTimeRangeAtom,
  lockedPresetRangeCandidates,
} from '@/store/dataset-studio'
import { useDatasetFeaturePreviewSample } from '@/hooks/dataset/use-dataset-feature-preview-sample'
import { useDelayedFlag } from '@/hooks/use-delayed-flag'
import { useStageSdtaPreset } from '@/hooks/use-sdta-preset'
import type { DatasetTagRow } from '@/hooks/dataset/use-dataset-tag-table'
import { DataAnalysisCard } from './data-analysis-card'
import { DataAnalysisCardSkeleton } from './data-analysis-card-skeleton'
import { ProcessingActionFooter } from './processing-action-footer'
import { PresetApplyManager, type AppliedPreset } from '../preset-apply-modal'
import { UseDatasetPipelineNavResult } from '@/hooks/dataset/use-dataset-pipeline-nav'
import { Loader2 } from 'lucide-react'

interface Props {
  nav: UseDatasetPipelineNavResult
}

export function Step31EDA({ nav }: Props) {
  const raw = useAtomValue(dwRawDatasetAtom)
  const period = useAtomValue(dwTimeRangeAtom)
  const range = PERIOD_TO_RANGE[period]

  const { cropRange, conditionalRules, statisticalRules } = nav

  // DS-LAKE-005B-D-T07. Same bounded page `Step4FeatureEngineering` warms
  // via this hook (`dwDraftArtifactIdAtom` — the draft's SILVER source
  // artifact — is identical at both steps; `DataAnalysisCard`'s own
  // GOLD-if-present-else-draft comment already documents that Step 3.1
  // always resolves to `draftArtifactId`). Calling it here too just warms
  // the shared atom earlier, before Step 4 ever mounts.
  useDatasetFeaturePreviewSample()
  const sample = useAtomValue(dwFeaturePreviewSampleAtom)

  // DS-LAKE-015-T03: the windows between Step 2 finishing and this card
  // having anything real to draw. `fetchRequired` matters because a
  // CSV-only wizard never calls `useDatasetBronzeWarm` at all —
  // `dwBronzeWarmStateAtom` would sit at 'idle' forever for that path, which
  // must read as "not applicable", not "stuck preparing". Selection logic
  // lives in `describeAnalysisReadiness` (lib/) so it is unit-testable
  // without rendering `DataAnalysisCard`'s atom-heavy tree.
  const fetchRequired = useAtomValue(dwFetchRequiredAtom)
  const bronzeWarmState = useAtomValue(dwBronzeWarmStateAtom)
  const previewFetchState = useAtomValue(dwFeaturePreviewSampleStateAtom)
  const readiness = describeAnalysisReadiness({
    fetchRequired,
    bronzeWarmState,
    previewFetchState,
    sampleTagCount: sample.tags.length,
  })
  const isBusy =
    readiness.phase === 'preparing' || readiness.phase === 'loading'
  // Anti-flicker: only reveal the skeleton after it has been busy for a beat —
  // a sub-150ms resolution should never flash a skeleton at all.
  const showSkeleton = useDelayedFlag(isBusy, 150)

  const precleansed = useMemo(
    () =>
      precleanse(raw, {
        crop: cropRange,
        conditional: conditionalRules,
        statistical: statisticalRules,
      }),
    [raw, cropRange, conditionalRules, statisticalRules],
  )

  // BOUNDED counterpart, for `DataAnalysisCard` only — `precleansed` above
  // (full frame) stays the source of truth for `emptied`/`nextDisabled`
  // below, which need the TRUE row count: a rule could empty the first N
  // rows of `sample` while thousands of real rows survive elsewhere in the
  // artifact, so gating navigation on the bounded result would be wrong.
  const precleansedSample = useMemo(
    () =>
      precleanseBounded(sample, {
        crop: cropRange,
        conditional: conditionalRules,
        statistical: statisticalRules,
      }),
    [sample, cropRange, conditionalRules, statisticalRules],
  )

  const emptied = raw.rows.length > 0 && precleansed.rows.length === 0

  // Edit mode only: Step 1's own Apply Preset button is rendered but inert
  // there (`step-1-tags.tsx`'s `pointer-events-none` lock — tags are frozen
  // once a dataset exists, since changing them would break downstream model
  // schemas). This is the one entry point left to apply a preset's range
  // cutoffs to an already-saved dataset.
  const setFeaturePreset = useSetAtom(dwFeaturePresetAtom)
  const setPresetRange = useSetAtom(dwPresetRangeAtom)
  const setPresetRangeStale = useSetAtom(dwPresetRangeStaleAtom)
  const stageSdta = useStageSdtaPreset()
  const lockedTags = useMemo(
    () => new Set(nav.selectedTags),
    [nav.selectedTags],
  )

  // Not `useDatasetTagTable` — that hook falls back to a MOCK tag catalogue
  // for any source it has no live PI search wired up for (Step 1's own,
  // hook-local, and not mounted here), which would make the modal's
  // comparison panel check the preset against fake tag names. This dataset's
  // real tags are already the locked list itself — a name is all the
  // comparison panel or the range-candidate filter below needs.
  const lockedRows: DatasetTagRow[] = useMemo(
    () =>
      nav.selectedTags.map(tagName => ({
        id: tagName,
        tagName,
        originalName: tagName,
        dataSource: '—',
        status: 'good' as const,
        sourceId: null,
      })),
    [nav.selectedTags],
  )

  const handleApplyPresetLocked = useCallback(
    (applied: AppliedPreset) => {
      const { document, summary } = applied
      // Informational only — never a schema write. Unlike Step 1's callback,
      // this deliberately does NOT touch tag selection, target Y, or Step
      // 4's feature configs: all three are locked surfaces in edit mode, and
      // silently writing to them here would defeat the lock those other
      // steps enforce.
      setFeaturePreset(summary)

      const { candidates, skippedCount } = lockedPresetRangeCandidates(
        document,
        lockedTags,
      )

      setPresetRange(prev => [
        ...prev.filter(c => c.presetId !== document.preset_id),
        ...candidates,
      ])
      setPresetRangeStale(document.schema_version < 2)

      if (skippedCount > 0) {
        toast.warning(
          `Applied ${document.name}, but ${skippedCount} range proposal(s) reference ` +
            `a tag this dataset doesn't have — tags can't be added while ` +
            `editing, so they were skipped.`,
        )
      } else if (candidates.length > 0) {
        toast.success(
          `Applied ${document.name}. ${candidates.length} range proposal(s) ` +
            `staged for review below.`,
        )
      } else {
        toast.info(
          `Applied ${document.name}. No range cutoffs to propose for this ` +
            `dataset's tags.`,
        )
      }
    },
    [lockedTags, setFeaturePreset, setPresetRange, setPresetRangeStale],
  )

  return (
    <div className="space-y-4">
      <h3>Exploratory Data Analysis (EDA)</h3>
      <p className="text-sm text-muted-foreground">
        Inspect data quality, crop the time range, and remove outliers before
        imputing missing values.
      </p>

      {nav.isEditLocked && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
          <p className="text-xs text-muted-foreground">
            Apply a feature preset&apos;s range cutoffs to this dataset&apos;s
            existing tags — tags themselves stay locked, so a preset that needs
            one this dataset doesn&apos;t have will skip it.
          </p>
          <PresetApplyManager
            rows={lockedRows}
            onApplyPreset={handleApplyPresetLocked}
            onApplySdta={(sdta, summary, importFileName) =>
              stageSdta(sdta, summary, importFileName)
            }
          />
        </div>
      )}

      {isBusy && (
        <div
          className="flex items-center justify-center gap-2"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p aria-hidden="true" className="text-[11px] text-muted-foreground">
            {readiness.caption}
          </p>
          <span className="sr-only">{readiness.caption}</span>
          {showSkeleton && <DataAnalysisCardSkeleton />}
        </div>
      )}

      {readiness.phase === 'error' && (
        <Alert variant="destructive">
          <AlertTitle>Preview sample unavailable</AlertTitle>
          <AlertDescription>{readiness.caption}</AlertDescription>
        </Alert>
      )}

      {readiness.phase === 'empty' && (
        <p className="text-[11px] text-muted-foreground p-2">
          {readiness.caption}
        </p>
      )}

      {readiness.phase === 'ready' && (
        <DataAnalysisCard dataset={precleansedSample} range={range} />
      )}

      {emptied && readiness.phase === 'ready' && (
        <Alert variant="destructive">
          <AlertTitle>These rules removed every row</AlertTitle>
          <AlertDescription>
            Loosen a crop bound or an outlier rule to keep some data.
          </AlertDescription>
        </Alert>
      )}

      <ProcessingActionFooter
        backLabel="Back"
        nextLabel="Continue"
        onBack={nav.back}
        onNext={nav.next}
        nextDisabled={precleansed.rows.length === 0 || isBusy}
      />
    </div>
  )
}
