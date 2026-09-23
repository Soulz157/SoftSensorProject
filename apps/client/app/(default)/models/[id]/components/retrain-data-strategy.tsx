'use client'

import { useEffect, useMemo, useState } from 'react'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useDatasets } from '@/hooks/dataset/use-datasets'
import { datasetVersionService } from '@/services/dataset-version'
import type { DatasetVersion } from '@/services/dataset-version'
import type { RetrainIncumbent } from '@/services/model-retrain'

export type RetrainDataStrategy =
  | 'KEEP_EXISTING'
  | 'AUGMENT_DATA'
  | 'NEW_DATA_ONLY'

/**
 * MODEL-SERVE-017. The strategies that need a dataset selected. Mirrors the
 * server's own `usesNewData` (model-retrain.authorized.dto.ts) — the DTO
 * refuses a strategy/id mismatch in either direction, so the form must use
 * the same rule or it would submit a request the server rejects.
 */
export function retrainUsesNewData(strategy: RetrainDataStrategy): boolean {
  return strategy === 'AUGMENT_DATA' || strategy === 'NEW_DATA_ONLY'
}

/**
 * MODEL-SERVE-015-T01. Sits ABOVE the Auto/Custom tabs in
 * `ModelRetrainDialog`, not inside either — one strategy applies to whichever
 * finetune mode the operator picks next, and both share the same combined
 * artifact once one is built.
 *
 * "Keep Existing Data" is the 014 default and does not change anything.
 * "Keep Existing + New Data" adds a dataset selector; the base dataset is
 * shown READ-ONLY, resolved server-side from the incumbent's own
 * ModelTrainingRun (`incumbent.baseDataset`) — never editable here, and
 * never derived from `Model.datasetId` (see that field's own comment).
 *
 * The version dropdown lists ONLY versions with a committed artifact
 * (`artifactId !== null`) — an uncommitted version would 422 at trigger
 * time (`assertCompatible`'s own check), so it is filtered out here instead
 * of offered and then refused.
 */
export function RetrainDataStrategy({
  workspaceId,
  incumbent,
  strategy,
  onStrategyChange,
  additionalDatasetVersionId,
  onAdditionalDatasetVersionChange,
  disabled,
}: {
  workspaceId: string
  incumbent: RetrainIncumbent | null
  strategy: RetrainDataStrategy
  onStrategyChange: (strategy: RetrainDataStrategy) => void
  additionalDatasetVersionId: string | null
  onAdditionalDatasetVersionChange: (versionId: string | null) => void
  disabled?: boolean
}) {
  const { datasets, loading: datasetsLoading } = useDatasets(workspaceId)
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(
    null,
  )
  const [versions, setVersions] = useState<DatasetVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)

  useEffect(() => {
    // No synchronous setState here — the dataset picker's own change handler
    // already clears `versions` at selection time, so there is nothing left
    // to reset when `selectedDatasetId` is null.
    if (!selectedDatasetId) return
    let ignore = false
    setVersionsLoading(true)
    void (async () => {
      try {
        const res = await datasetVersionService.list(selectedDatasetId)
        if (!ignore) setVersions(res.data ?? [])
      } finally {
        if (!ignore) setVersionsLoading(false)
      }
    })()
    return () => {
      ignore = true
    }
  }, [selectedDatasetId])

  // Only committed (has a FINAL artifact) versions are offered — an
  // uncommitted one would 422 at trigger time (assertCompatible's own
  // check).
  const committedVersions = useMemo(
    () => versions.filter(v => v.artifactId !== null),
    [versions],
  )

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="space-y-1.5">
        <Label>Training data</Label>
        <RadioGroup
          value={strategy}
          onValueChange={v => onStrategyChange(v as RetrainDataStrategy)}
          disabled={disabled || !incumbent}
        >
          <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-2.5 text-xs has-[[data-checked]]:border-primary has-[[data-checked]]:bg-primary/5">
            <RadioGroupItem value="KEEP_EXISTING" className="mt-0.5" />
            <span>
              <span className="block font-medium text-foreground">
                Keep Existing Data
              </span>
              <span className="block text-muted-foreground">
                Retrain on the incumbent&apos;s own training data only.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-2.5 text-xs has-[[data-checked]]:border-primary has-[[data-checked]]:bg-primary/5">
            <RadioGroupItem
              value="AUGMENT_DATA"
              className="mt-0.5"
              disabled={!incumbent?.baseDataset}
            />
            <span>
              <span className="block font-medium text-foreground">
                Keep Existing + New Data
              </span>
              <span className="block text-muted-foreground">
                Combine the existing training data with a newly selected
                dataset.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-2.5 text-xs has-[[data-checked]]:border-primary has-[[data-checked]]:bg-primary/5">
            <RadioGroupItem
              value="NEW_DATA_ONLY"
              className="mt-0.5"
              disabled={!incumbent?.baseDataset}
            />
            <span>
              <span className="block font-medium text-foreground">
                New Data Only
              </span>
              <span className="block text-muted-foreground">
                Train on the newly selected dataset alone. Still scored on the
                incumbent&apos;s own test rows, so the comparison holds.
              </span>
            </span>
          </label>
        </RadioGroup>
      </div>

      {retrainUsesNewData(strategy) && (
        <div className="space-y-3 border-t border-border pt-3">
          <div className="space-y-1.5">
            <Label>Additional dataset</Label>
            {datasetsLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <Select
                value={selectedDatasetId ?? undefined}
                onValueChange={id => {
                  setSelectedDatasetId(id)
                  setVersions([])
                  onAdditionalDatasetVersionChange(null)
                }}
                disabled={disabled}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select dataset" />
                </SelectTrigger>
                <SelectContent>
                  {datasets.map(ds => (
                    <SelectItem key={ds.id} value={ds.id}>
                      {ds.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {selectedDatasetId && (
            <div className="space-y-1.5">
              <Label>Version</Label>
              {versionsLoading ? (
                <Skeleton className="h-9 w-full" />
              ) : committedVersions.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No saved version of this dataset has a committed artifact yet.
                </p>
              ) : (
                <Select
                  value={additionalDatasetVersionId ?? undefined}
                  onValueChange={onAdditionalDatasetVersionChange}
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select version" />
                  </SelectTrigger>
                  <SelectContent>
                    {committedVersions.map(v => (
                      <SelectItem key={v.id} value={v.id}>
                        v{v.versionNumber} · {v.rowCount.toLocaleString()} rows
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * MODEL-SERVE-015-T01. The dataset the incumbent was ACTUALLY trained on —
 * read-only context, shown on the dialog's right-hand side beside the
 * decisions the operator makes on the left. Resolved server-side off the
 * incumbent's own ModelTrainingRun (`incumbent.baseDataset`), never
 * `Model.datasetId`, and never editable here.
 *
 * Shown for BOTH strategies, not only augmentation: it names what "Keep
 * Existing Data" keeps as much as what "Keep Existing + New Data" adds to.
 */
export function RetrainBaseDataset({
  incumbent,
}: {
  incumbent: RetrainIncumbent | null
}) {
  const base = incumbent?.baseDataset ?? null
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
      <Label>Base dataset</Label>
      {base ? (
        <div className="space-y-0.5">
          <p className="text-sm font-medium break-words text-foreground">
            {base.datasetName}
          </p>
          {base.versionNumber !== null && (
            <p className="text-xs text-muted-foreground">
              Version v{base.versionNumber}
            </p>
          )}
          <p className="text-xs text-muted-foreground italic">
            Existing training data · read-only
          </p>
        </div>
      ) : (
        <p className="text-xs text-destructive">
          The incumbent&apos;s training data could not be resolved — data
          augmentation is unavailable for this model.
        </p>
      )}
    </div>
  )
}
