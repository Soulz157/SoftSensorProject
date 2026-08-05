'use client'

import { useMemo, useState } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, Layers, Save } from 'lucide-react'
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
import { materializeBlocker } from '@/hooks/dataset/use-dataset-version-rows'
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
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  // Save has two server phases: the dataset row, then the stored artifact.
  // Tracked separately so the button can name the slow one — materialising
  // re-fetches the whole window from the source and can run for minutes.
  const [storing, setStoring] = useState(false)

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

  // Loud, non-blocking: a soft-sensor dataset with every X and no Y is exactly
  // the failure this feature exists to prevent, but the wizard legitimately
  // supports assembling X now and joining lab Y later — hard-blocking Save
  // would make that workflow impossible. Every workbook target is a `.lab`
  // tag absent from PI by construction, so this is expected, not exceptional.
  const targetMissing = Boolean(
    targetTag && !finalDataset.tags.includes(targetTag),
  )

  const handleSave = async () => {
    if (!name.trim() || !workspaceId) return
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

    try {
      const res =
        mode === 'edit'
          ? await datasetService.update(editingDatasetId, body)
          : await datasetService.create(body)
      toast.success(
        mode === 'edit'
          ? `Dataset "${res.data.name}" updated`
          : `Dataset "${res.data.name}" created`,
      )

      // Store the rows as a Parquet artifact so every later reader — Edit, the
      // model wizard — gets the user's REAL data instead of a regenerated
      // stand-in. Gated on `currentArtifactId` being null so an edit-save never
      // mints a redundant second BRONZE artifact: the recipe may have changed,
      // the source window did not.
      //
      // DS-LAKE-004 moved this off `currentVersionId`. That pointer now stays
      // null until Save Dataset creates a version, so testing it here would
      // have re-fetched the whole source window on EVERY edit-save.
      if (!res.data.currentArtifactId) {
        await storeRows(res.data.id, pipelineConfig)
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
        disabled={!name.trim() || !workspaceId || saving || saved}
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
    </div>
  )
}
