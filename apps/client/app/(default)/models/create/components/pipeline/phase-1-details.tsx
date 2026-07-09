'use client'

import { Layers } from 'lucide-react'
import type { WorkspacePlant } from '@/types'
import type { CanvasNode } from '@/services/canvas'
import type { WizardMode } from '@/store/model-pipeline'
import { useDatasets } from '@/hooks/dataset/use-datasets'
import type { SavedDataset } from '@/store/datasets'
import { ModelMetadataSection } from '../model-metadata-section'
import { PresetPicker } from './preset-picker'
import { DatasetCard } from '../dataset-card'

interface Props {
  mode: WizardMode
  name: string
  description: string
  workspaceId: string
  plantId: string
  nodeId: string
  plants: WorkspacePlant[]
  nodes: CanvasNode[]
  plantsLoading: boolean
  nameConflict: boolean
  selectedDataset: SavedDataset | null
  onName: (v: string) => void
  onDescription: (v: string) => void
  onWorkspace: (id: string) => void
  onPlant: (id: string) => void
  onNode: (id: string) => void
  onSelectDataset: (dataset: SavedDataset) => void
}

export function Phase1Details({
  mode,
  selectedDataset,
  onSelectDataset,
  ...props
}: Props) {
  const { datasets, loading } = useDatasets(props.workspaceId || undefined)

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-medium text-foreground">Model details</h2>
        <p className="text-xs text-muted-foreground">
          Name your model and choose where it lives.
        </p>
      </div>
      {mode === 'create' && <PresetPicker workspaceId={props.workspaceId} />}
      <ModelMetadataSection {...props} disabled={false} />

      <div className="space-y-2">
        <h2 className="text-sm font-medium text-foreground">
          Select a dataset
        </h2>
        <p className="text-xs text-muted-foreground">
          Train on a curated dataset built in Data Studio — no need to reconnect
          or re-clean data.
        </p>
        {!props.workspaceId ? null : loading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-xl bg-muted"
                aria-hidden="true"
              />
            ))}
          </div>
        ) : datasets.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl bg-muted/30 py-8 text-center ring-1 ring-foreground/10">
            <Layers className="h-7 w-7 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground">
              No datasets yet in this workspace — create one in Data Studio
              first.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {datasets.map(d => (
              <DatasetCard
                key={d.id}
                dataset={d}
                selected={selectedDataset?.id === d.id}
                onSelect={() => onSelectDataset(d)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
