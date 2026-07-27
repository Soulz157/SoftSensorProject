'use client'

import { useState } from 'react'
import { FolderGit2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { SavedDataset } from '@/store/datasets'
import type { CreateDatasetInput } from '@/services/dataset'
import type { useDataStudio } from '@/hooks/dataset/use-data-studio'
import { EditDatasetDialog } from './edit-dataset-dialog'
import { DatasetCard } from './dataset-card'
import { DatasetConfigDialog } from './dataset-config-dialog'
import { DatasetDetailSheet, type DetailSource } from './dataset-detail-sheet'

type Studio = ReturnType<typeof useDataStudio>

interface Props {
  datasets: Studio['datasets']
  filteredDatasets: Studio['filteredDatasets']
  getWorkspaceName: Studio['getWorkspaceName']
  getSourceName: Studio['getSourceName']
  getSourceMeta: Studio['getSourceMeta']
  onCreateDataset: () => void
  onDeleteDataset: (id: string) => Promise<void>
  onRenameDataset: (
    id: string,
    patch: Partial<CreateDatasetInput>,
  ) => Promise<void>
  onEditDataset: (dataset: SavedDataset) => void
  onDuplicateDataset: (dataset: SavedDataset) => void
}

export function DatasetsTab({
  datasets,
  filteredDatasets,
  getWorkspaceName,
  getSourceName,
  getSourceMeta,
  onCreateDataset,
  onDeleteDataset,
  onRenameDataset,
  onEditDataset,
  onDuplicateDataset,
}: Props) {
  const [renameTarget, setRenameTarget] = useState<SavedDataset | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SavedDataset | null>(null)
  const [detailTarget, setDetailTarget] = useState<SavedDataset | null>(null)
  const [configTarget, setConfigTarget] = useState<SavedDataset | null>(null)

  if (datasets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/20 py-20 text-center">
        <span className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <FolderGit2 className="h-6 w-6" />
        </span>
        <p className="text-sm font-semibold">No datasets found</p>
        <p className="mx-auto max-w-72 text-xs text-muted-foreground">
          Create a dataset from your connected sources to begin your modeling
          workflow.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="mt-4"
          onClick={onCreateDataset}
        >
          Create Dataset
        </Button>
      </div>
    )
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filteredDatasets.map(d => {
          const firstId = d.sourceIds[0]
          const first = firstId ? getSourceMeta(firstId) : null
          return (
            <DatasetCard
              key={d.id}
              dataset={d}
              workspaceName={getWorkspaceName(d.workspaceId)}
              sourceName={firstId ? getSourceName(firstId) : 'No source'}
              sourceType={first?.type ?? null}
              extraSources={d.sourceIds.length - 1}
              onViewDetails={() => setDetailTarget(d)}
              onEditPipeline={() => onEditDataset(d)}
              onViewConfig={() => setConfigTarget(d)}
              onDuplicate={() => onDuplicateDataset(d)}
              onRename={() => setRenameTarget(d)}
              onDelete={() => setDeleteTarget(d)}
            />
          )
        })}
      </div>

      <DatasetDetailSheet
        dataset={detailTarget}
        open={detailTarget !== null}
        onOpenChange={open => !open && setDetailTarget(null)}
        workspaceName={
          detailTarget ? getWorkspaceName(detailTarget.workspaceId) : ''
        }
        sources={
          detailTarget
            ? detailTarget.sourceIds.map(
                (id): DetailSource => getSourceMeta(id),
              )
            : []
        }
      />

      <DatasetConfigDialog
        dataset={configTarget}
        open={configTarget !== null}
        onOpenChange={open => !open && setConfigTarget(null)}
      />

      <EditDatasetDialog
        open={renameTarget !== null}
        onOpenChange={open => !open && setRenameTarget(null)}
        dataset={renameTarget}
        onSave={(name, description) => {
          if (!renameTarget) return
          void onRenameDataset(renameTarget.id, { name, description })
          toast.success('Dataset updated')
          setRenameTarget(null)
        }}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={open => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete &quot;{deleteTarget?.name}&quot;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) {
                  void onDeleteDataset(deleteTarget.id)
                  toast.success('Dataset deleted')
                }
                setDeleteTarget(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
