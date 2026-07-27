'use client'

import { useMemo, useState } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckCircle2, Layers, Save } from 'lucide-react'
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
  const resetWizard = useSetAtom(resetDatasetWizardAtom)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const {
    cropRange,
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
    exclusions,
    conditionalRules,
    statisticalRules,
    cleaningPipelines,
    selectedColumns,
    scalerConfigs,
  ])

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
      setSaved(true)
      toast.success(
        mode === 'edit'
          ? `Dataset "${res.data.name}" updated`
          : `Dataset "${res.data.name}" created`,
      )
      resetWizard()
      router.push('/data-studio')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save dataset')
    } finally {
      setSaving(false)
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
            {saving
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
