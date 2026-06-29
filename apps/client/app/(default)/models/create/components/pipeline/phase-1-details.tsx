'use client'

import type { WorkspacePlant } from '@/types'
import type { CanvasNode } from '@/services/canvas'
import type { WizardMode } from '@/store/model-pipeline'
import { ModelMetadataSection } from '../model-metadata-section'
import { PresetPicker } from './preset-picker'

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
  onName: (v: string) => void
  onDescription: (v: string) => void
  onWorkspace: (id: string) => void
  onPlant: (id: string) => void
  onNode: (id: string) => void
}

export function Phase1Details({ mode, ...props }: Props) {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-medium text-foreground">Model details</p>
        <p className="text-xs text-muted-foreground">
          Name your model and choose where it lives.
        </p>
      </div>
      {mode === 'create' && <PresetPicker workspaceId={props.workspaceId} />}
      <ModelMetadataSection {...props} disabled={false} />
    </div>
  )
}
