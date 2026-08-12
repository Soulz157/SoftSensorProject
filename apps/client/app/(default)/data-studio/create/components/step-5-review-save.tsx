'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Layers,
  Loader2,
  Save,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { precleanse } from '@/lib/precleanse'
import { preprocessPipelines, toModelReady } from '@/lib/preprocessing'
import { applyFeatures, selectColumns } from '@/lib/feature-engineering'
import { datasetQuality } from '@/lib/data-quality'
import type { PipelineConfig } from '@/lib/pipeline-config'
import { datasetService } from '@/services/dataset'
import { datasetVersionService } from '@/services/dataset-version'
import { datasetDraftService } from '@/services/dataset-draft'
import { materializeBlocker } from '@/hooks/dataset/use-dataset-version-rows'
import { useDatasetValidation } from '@/hooks/dataset/use-dataset-validation'
import { toPiTime } from '@/lib/dataset-fetch'
import {
  dwNameAtom,
  dwDescriptionAtom,
  dwWorkspaceIdAtom,
  dwSelectedSourcesAtom,
  dwRawDatasetAtom,
  dwFeatureConfigsAtom,
  dwCleaningPipelinesAtom,
  dwTimeRangeAtom,
  dwCustomDateRangeAtom,
  dwCustomIntervalAtom,
  dwSourceFetchConfigsAtom,
  dwSelectedTagsAtom,
  dwTagConstantsAtom,
  dwModeAtom,
  dwEditingDatasetIdAtom,
  dwFeaturePresetAtom,
  dwTargetTagAtom,
  dwDraftGoldArtifactIdAtom,
  resetDatasetWizardAtom,
} from '@/store/dataset-studio'
import type { UseDatasetPipelineNavResult } from '@/hooks/dataset/use-dataset-pipeline-nav'

interface Props {
  nav: UseDatasetPipelineNavResult
}

export function Step5ReviewSave({ nav }: Props) {
  const router = useRouter()
  const [name, setName] = useAtom(dwNameAtom)
  const [description, setDescription] = useAtom(dwDescriptionAtom)
  const workspaceId = useAtomValue(dwWorkspaceIdAtom)
  const sources = useAtomValue(dwSelectedSourcesAtom)
  const raw = useAtomValue(dwRawDatasetAtom)
  const features = useAtomValue(dwFeatureConfigsAtom)
  const cleaningPipelines = useAtomValue(dwCleaningPipelinesAtom)
  const timeRange = useAtomValue(dwTimeRangeAtom)
  const customDateRange = useAtomValue(dwCustomDateRangeAtom)
  const customInterval = useAtomValue(dwCustomIntervalAtom)
  const sourceFetchConfigs = useAtomValue(dwSourceFetchConfigsAtom)
  const baseTags = useAtomValue(dwSelectedTagsAtom)
  const tagConstants = useAtomValue(dwTagConstantsAtom)
  const mode = useAtomValue(dwModeAtom)
  const editingDatasetId = useAtomValue(dwEditingDatasetIdAtom)
  const featurePreset = useAtomValue(dwFeaturePresetAtom)
  const targetTag = useAtomValue(dwTargetTagAtom)
  const resetWizard = useSetAtom(resetDatasetWizardAtom)
  const validation = useDatasetValidation()
  const goldArtifactId = useAtomValue(dwDraftGoldArtifactIdAtom)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  // Save has two server phases: the dataset row, then the stored artifact.
  // Tracked separately so the button can name the slow one — materialising
  // re-fetches the whole window from the source and can run for minutes.
  const [storing, setStoring] = useState(false)
  // DS-LAKE-005B-B-T01 (Step 5 leg). Caches the FINAL artifact produced by
  // the last successful finalize call, keyed to the gate artifact it was
  // promoted FROM — a retry after an unrelated error (e.g. a name
  // collision) reuses it instead of minting a second FINAL off the same
  // GOLD/SILVER. Invalidated automatically the moment gateArtifactId
  // itself changes (a new recipe/clean/feature run), never reused stale.
  const finalizedRef = useRef<{ from: string; finalId: string } | null>(null)

  const {
    cropRange,
    valueCrop,
    exclusions,
    conditionalRules,
    statisticalRules,
    selectedColumns,
    scalerConfigs,
  } = nav

  // Same pipeline as `materializeDataset`:
  // raw → features → precleanse → fill → select → scale.
  const { cleansed, finalDataset } = useMemo(() => {
    const featured = applyFeatures(raw, features)
    const cleaned = precleanse(featured, {
      crop: cropRange,
      valueCrop,
      exclusions,
      conditional: conditionalRules,
      statistical: statisticalRules,
    })
    const filled = preprocessPipelines(cleaned, cleaningPipelines)
    const selected = selectColumns(filled, selectedColumns)
    return {
      cleansed: cleaned,
      finalDataset: toModelReady(selected, scalerConfigs),
    }
  }, [
    raw,
    features,
    cropRange,
    valueCrop,
    exclusions,
    conditionalRules,
    statisticalRules,
    cleaningPipelines,
    selectedColumns,
    scalerConfigs,
  ])

  // DS-LAKE-008-T03. Same recipe fields `finalDataset` itself already
  // depends on (minus `raw` — a source/time-range change, not a recipe
  // edit; `raw`'s own downstream re-materialize rotates gateArtifactId on
  // its own timeline). Forces `validation.revalidate()` — clearing `report`
  // synchronously (see the hook's own doc comment) — the INSTANT a recipe
  // field changes, without waiting for Step 3.2's clean job or Step 4's
  // 800ms-debounced gold-warm to finish and rotate `gateArtifactId`. That
  // rotation already re-validates on its own (T01's effect), but only
  // AFTER the new artifact exists; this closes the lag window in between,
  // where a PASS computed against the artifact BEFORE the edit would
  // otherwise still read as valid. Skips its first firing (mount) — T01's
  // own effect already runs the initial validation; without the guard this
  // would double-call on every mount for no reason.
  const isFirstRecipeEffectRef = useRef(true)
  useEffect(() => {
    if (isFirstRecipeEffectRef.current) {
      isFirstRecipeEffectRef.current = false
      return
    }
    validation.revalidate()
    // `validation.revalidate` is intentionally excluded — its identity
    // changes with gateArtifactId/draftId too, and T01's own effect
    // already re-validates on THAT change; including it here would double
    // -fire this effect for a rotation this effect doesn't need to react to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    features,
    cropRange,
    valueCrop,
    exclusions,
    conditionalRules,
    statisticalRules,
    cleaningPipelines,
    selectedColumns,
    scalerConfigs,
  ])

  // Loud, non-blocking: a soft-sensor dataset with every X and no Y is exactly
  // the failure this feature exists to prevent, but the wizard legitimately
  // supports assembling X now and joining lab Y later — hard-blocking Save
  // would make that workflow impossible. Every workbook target is a `.lab`
  // tag absent from PI by construction, so this is expected, not exceptional.
  const targetMissing = Boolean(
    targetTag && !finalDataset.tags.includes(targetTag),
  )

  // DS-LAKE-005B-B-T01 (Step 5 leg, advisor-flagged). `validation.gateArtifactId`
  // falls back to SILVER when GOLD isn't ready yet — correct for showing SOME
  // quality signal early, but WRONG to finalize/save: a recipe with real
  // features/column-selection would get promoted from an artifact that has
  // neither, so the saved Dataset would advertise columns its own artifact
  // doesn't contain. Blocks Save (not just the new-path branch) until GOLD
  // catches up, rather than silently finalizing SILVER for a feature recipe.
  const featuresRequested =
    features.length > 0 || Boolean(selectedColumns && selectedColumns.length)
  const goldNotReady = Boolean(
    validation.draftId && featuresRequested && !goldArtifactId,
  )

  // DS-LAKE-008-T02. Blocks on the SAME status ValidationReportCard (T01)
  // already reads — 'unavailable' (nothing to validate yet, e.g. edit mode)
  // is deliberately NOT blocking; only 'pending' and 'FAIL' are, matching
  // this task's own title. Checked both here (so a click cannot slip
  // through the disabled attribute — V03's no-write-on-FAIL guarantee
  // needs a real guard, not just a UI affordance) and on the Button below.
  const validationBlocking =
    validation.status === 'pending' ||
    validation.status === 'FAIL' ||
    goldNotReady
  const validationBlockReason = goldNotReady
    ? 'Waiting for feature engineering to finish…'
    : validation.status === 'pending'
      ? 'Waiting for validation to finish…'
      : validation.status === 'FAIL'
        ? 'Fix the failed check(s) above before saving.'
        : null

  const handleSave = async () => {
    if (!name.trim() || !workspaceId || validationBlocking) return
    setSaving(true)

    const pipelineConfig: PipelineConfig = {
      timeRange,
      customDateRange,
      customInterval,
      sourceFetchConfigs,
      features,
      cropRange,
      valueCrop,
      exclusions,
      conditionalRules,
      statisticalRules,
      cleaningPipelines,
      selectedColumns,
      scalers: scalerConfigs,
      // Step-1 base tags + Manual/CSV constants — let edit mode rebuild the raw
      // dataset deterministically without re-running Step 1/2.
      baseTags,
      tagConstants,
      // Preset provenance, so re-opening this recipe in edit mode shows where
      // the equations came from. Both undefined when no preset was applied.
      featurePreset: featurePreset ?? undefined,
      targetTag: targetTag ?? undefined,
    }

    try {
      // DS-LAKE-005B-B-T01 (Step 5 leg, ADR-DS-LAKE-005B-B-006). Adopts the
      // draft's completed artifact by pointer — no raw re-fetch, no recipe
      // replay server-side. Only reachable in create mode with a real draft
      // + gate artifact; edit mode and any create-mode flow with no draft
      // (e.g. CSV-only) keep the legacy path below untouched.
      if (
        mode === 'create' &&
        validation.draftId &&
        validation.gateArtifactId
      ) {
        const draftId = validation.draftId
        const gateArtifactId = validation.gateArtifactId

        let finalArtifactId =
          finalizedRef.current?.from === gateArtifactId
            ? finalizedRef.current.finalId
            : null
        if (!finalArtifactId) {
          const finalizeRes = await datasetDraftService.finalize(
            draftId,
            gateArtifactId,
            {},
          )
          finalArtifactId = finalizeRes.data.id
          finalizedRef.current = {
            from: gateArtifactId,
            finalId: finalArtifactId,
          }
        }

        await datasetDraftService.save(draftId, {
          name: name.trim(),
          description: description.trim() || undefined,
          tags: finalDataset.tags,
          pipelineConfig,
          fileUrl: null,
        })
        toast.success(`Dataset "${name.trim()}" created`)
      } else {
        const body = {
          name: name.trim(),
          description: description.trim() || undefined,
          workspaceId,
          sourceIds: sources.map(s => s.id),
          tags: finalDataset.tags,
          pipelineConfig,
          fileUrl: null,
          rowCount: finalDataset.rows.length,
          // Missing-values status is measured pre-fill (how much needed imputation).
          missingPct: datasetQuality(cleansed).missingPct,
        }

        const res =
          mode === 'edit'
            ? await datasetService.update(editingDatasetId, body)
            : await datasetService.create(body)
        toast.success(
          mode === 'edit'
            ? `Dataset "${res.data.name}" updated`
            : `Dataset "${res.data.name}" created`,
        )

        // Store the rows as a Parquet artifact so every later reader — Edit,
        // the model wizard — gets the user's REAL data instead of a
        // regenerated stand-in. Gated on `currentArtifactId` being null so
        // an edit-save never mints a redundant second BRONZE artifact: the
        // recipe may have changed, the source window did not.
        //
        // DS-LAKE-004 moved this off `currentVersionId`. That pointer now
        // stays null until Save Dataset creates a version, so testing it
        // here would have re-fetched the whole source window on EVERY
        // edit-save.
        if (!res.data.currentArtifactId) {
          await storeRows(res.data.id, pipelineConfig)
        }
      }

      setSaved(true)
      resetWizard()
      router.push('/data-studio')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save dataset')
    } finally {
      setSaving(false)
      setStoring(false)
    }
  }

  /**
   * Materialise V1 from the saved recipe. Best-effort by design: the dataset
   * row is already committed, so a fetch that fails must not fail the save —
   * it is reported, and `useDatasetVersionRows` retries on the next Edit-open.
   */
  const storeRows = async (datasetId: string, config: PipelineConfig) => {
    const blocker = materializeBlocker(config)
    if (blocker) {
      toast.info(`Rows not stored: ${blocker}`)
      return
    }

    setStoring(true)
    try {
      await datasetVersionService.createRaw(datasetId, {
        sourceId: Object.keys(config.sourceFetchConfigs)[0]!,
        tags: config.baseTags!,
        startTime: toPiTime(config.customDateRange!.from),
        endTime: toPiTime(config.customDateRange!.to),
      })
      toast.success('Rows stored')
    } catch (err) {
      toast.warning(
        `Dataset saved, but its rows could not be stored: ${
          err instanceof Error ? err.message : 'the source could not be read'
        }`,
      )
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Layers className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-medium text-foreground">
          Review &amp; Save
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="dw-name" className="text-xs font-medium">
            Dataset name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="dw-name"
            value={name}
            onChange={e => setName(e.target.value)}
            className="h-9 text-sm"
            disabled={saving || saved}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dw-desc" className="text-xs font-medium">
            Description{' '}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </Label>
          <Textarea
            id="dw-desc"
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="min-h-9 resize-none text-sm"
            disabled={saving || saved}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <p className="text-xs text-muted-foreground">Sources</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {sources.length}
          </p>
        </div>
        <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <p className="text-xs text-muted-foreground">Tags</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {finalDataset.tags.length}
          </p>
        </div>
        <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <p className="text-xs text-muted-foreground">Rows</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {finalDataset.rows.length.toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <p className="text-xs text-muted-foreground">Raw rows</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {raw.rows.length.toLocaleString()}
          </p>
        </div>
      </div>

      {featurePreset && (
        <p className="text-xs text-muted-foreground">
          Built from preset:{' '}
          <span className="font-mono text-foreground">
            {featurePreset.name}
          </span>
        </p>
      )}

      {targetMissing && (
        // Loud through placement + icon, not colour: amber/red are reserved
        // for plant operating state (DESIGN.md §2), and an unjoined lab target
        // is a data-workflow state, not one. Deliberately NOT disabling Save —
        // assembling X now and joining lab Y later is a legitimate workflow.
        <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="space-y-0.5 text-xs">
            <p className="font-medium text-foreground">
              Target <span className="font-mono">{targetTag}</span> is not in
              this dataset
            </p>
            <p className="text-muted-foreground">
              This dataset can be saved, but it cannot train a model until the
              target is supplied — typically by CSV upload or lab ingestion.
            </p>
          </div>
        </div>
      )}

      <ValidationReportCard validation={validation} />

      <div className="space-y-1.5">
        <p className="text-xs font-medium">Included sources</p>
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border bg-muted/40 p-2">
          {sources.map(s => (
            <div
              key={s.id}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs"
            >
              <span className="font-medium">{s.name}</span>
              <span className="text-muted-foreground">· {s.host}</span>
            </div>
          ))}
        </div>
      </div>

      <Button
        className="h-10 w-full gap-2"
        disabled={
          !name.trim() || !workspaceId || saving || saved || validationBlocking
        }
        onClick={handleSave}
      >
        {saved ? (
          <>
            <CheckCircle2 className="h-4 w-4" />
            Saved
          </>
        ) : (
          <>
            <Save className="h-4 w-4" />
            {storing
              ? 'Storing rows…'
              : saving
                ? 'Saving…'
                : mode === 'edit'
                  ? 'Save Changes'
                  : 'Save Dataset'}
          </>
        )}
      </Button>
      {/* DS-LAKE-008-T02. Stated on the control, not a toast — the reason
          disappears the instant validation.status stops blocking. */}
      {validationBlockReason && !saving && !saved && (
        <p className="-mt-3 text-center text-xs text-muted-foreground">
          {validationBlockReason}
        </p>
      )}
    </div>
  )
}

const CHECK_LABELS: Record<string, string> = {
  schema: 'Schema',
  missing_values: 'Missing values',
  duplicate_timestamps: 'Duplicate timestamps',
  feature_consistency: 'Feature consistency',
  statistical: 'Statistical outliers',
  completeness: 'Tag completeness',
}

/**
 * DS-LAKE-008-T01/T04. Neutral treatment throughout, by rule — red/amber are
 * reserved for workspace/plant status (DESIGN_SYSTEM.md §5); data-quality UI
 * (this card, and the pre-existing `targetMissing` block above) signals
 * through icon + placement + wording, never hue. `unavailable` renders
 * nothing — the gate does not apply yet (see `useDatasetValidation`'s own
 * doc comment for exactly when).
 */
function ValidationReportCard({
  validation,
}: {
  validation: ReturnType<typeof useDatasetValidation>
}) {
  const { status, report, error } = validation

  if (status === 'unavailable') return null

  if (status === 'pending') {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 p-3">
        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
        <div className="space-y-0.5 text-xs">
          <p className="font-medium text-foreground">
            Validating dataset quality…
          </p>
          {error && (
            <p className="text-muted-foreground">
              Last attempt failed: {error}. Retrying will run again on the next
              change.
            </p>
          )}
        </div>
      </div>
    )
  }

  if (!report) return null
  const passed = status === 'PASS'

  return (
    <div className="space-y-2 rounded-xl border border-border bg-muted/40 p-3">
      <div className="flex items-start gap-2.5">
        {passed ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
        )}
        <div className="space-y-0.5 text-xs">
          <p className="font-medium text-foreground">
            {passed
              ? `Validation passed — quality score ${report.quality_score}/100`
              : `Validation failed — quality score ${report.quality_score}/100`}
          </p>
          <p className="text-muted-foreground">
            {passed
              ? 'All checks passed or were not applicable.'
              : `${report.failed_checks.length} check(s) failed: ${report.failed_checks
                  .map(name => CHECK_LABELS[name] ?? name)
                  .join(', ')}.`}
          </p>
        </div>
      </div>

      <div className="space-y-1 border-t border-border/60 pt-2">
        {report.checks.map(check => (
          <div
            key={check.name}
            className="flex items-center gap-2 text-xs text-muted-foreground"
          >
            {check.skipped ? (
              <CircleDashed className="h-3.5 w-3.5 shrink-0" />
            ) : check.passed ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <XCircle className="h-3.5 w-3.5 shrink-0 text-foreground" />
            )}
            <span className="font-medium text-foreground">
              {CHECK_LABELS[check.name] ?? check.name}
            </span>
            <span className="">{check.detail}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
