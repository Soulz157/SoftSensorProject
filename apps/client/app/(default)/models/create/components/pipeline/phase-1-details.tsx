'use client'

import type { WorkspacePlant } from '@/types'
import type { CanvasNode } from '@/services/canvas'
import type { WizardMode } from '@/store/model-pipeline'
import type { SavedDataset } from '@/store/datasets'
import { ModelMetadataSection } from '../model-metadata-section'
import { DraftResumeSection } from './draft-resume-section'
import { PresetPicker } from './preset-picker'
import { DatasetPicker } from './dataset-picker'

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
  totalSteps: number
  onName: (v: string) => void
  onDescription: (v: string) => void
  onWorkspace: (id: string) => void
  onPlant: (id: string) => void
  onNode: (id: string) => void
  onSelectDataset: (dataset: SavedDataset) => void
}

/**
 * Step 1 — order follows the Laws of UX, not the historical build order:
 *
 * 1. Drafts (unscoped) and the preset trigger (gated) sit ABOVE the form —
 *    Zeigarnik/Serial Position for the accelerators, Von Restorff for the
 *    primary path they must not visually outrank.
 * 2. Identity → Location resolves `workspaceId` before anything that reads
 *    it (Jakob's Law: dependency order should match reading order), rather
 *    than reordering the accelerators away from the top where recall is
 *    highest — instead each downstream consumer states its own prerequisite.
 * 3. DatasetPicker is the last block, and states its own prerequisite
 *    explicitly instead of rendering nothing (Visibility of System Status).
 */
export function Phase1Details({
  mode,
  selectedDataset,
  onSelectDataset,
  totalSteps,
  ...props
}: Props) {
  // Shared by both accelerators so "does this form already hold work"
  // means the same thing whichever one is asked (Jakob's Law — the two
  // should behave consistently, not just look alike).
  const dirty = props.name.trim() !== '' || selectedDataset !== null

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-foreground">Model details</h2>
          <span className="text-xs text-muted-foreground">
            Step 1 of {totalSteps}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Name your model and choose where it lives.
        </p>
      </div>

      {mode === 'create' && (
        <>
          {/* Above the preset picker: picking up unfinished work is a
              different intent from starting new, and it should be offered
              before the choices that assume you are starting new. Edit mode
              is editing a saved Model — there is no draft to resume. */}
          <DraftResumeSection workspaceId={props.workspaceId} dirty={dirty} />
          <PresetPicker workspaceId={props.workspaceId} dirty={dirty} />
        </>
      )}

      <ModelMetadataSection {...props} disabled={false} />

      <DatasetPicker
        workspaceId={props.workspaceId}
        selectedDataset={selectedDataset}
        onSelectDataset={onSelectDataset}
      />
    </div>
  )
}
