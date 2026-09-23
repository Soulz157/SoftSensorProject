'use client'

import { useState } from 'react'
import { FolderGit2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ListPagination } from '@/components/list-pagination'
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
import { useDatasetDependents } from '@/hooks/dataset/use-dataset-dependents'
import { EditDatasetDialog } from './edit-dataset-dialog'
import { DatasetCard } from './dataset-card'
import { DatasetConfigDialog } from './dataset-config-dialog'
import { DatasetDetailSheet, type DetailSource } from './dataset-detail-sheet'

const PER_PAGE = 8

type Studio = ReturnType<typeof useDataStudio>

interface Props {
  datasets: Studio['datasets']
  filteredDatasets: Studio['filteredDatasets']
  getWorkspaceName: Studio['getWorkspaceName']
  getSourceName: Studio['getSourceName']
  getSourceMeta: Studio['getSourceMeta']
  /** `useDataSources()`'s own loading flag — threaded through so the detail
   * sheet can show a skeleton instead of "Unknown source" during the window
   * before `allSources` arrives. */
  sourcesLoading: boolean
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
  sourcesLoading,
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
  // DS-LAKE-030-T02. Fires only while the confirm dialog is open — see the
  // hook's own doc for why this is not prefetched per card.
  const { models: dependents, state: dependentsState } = useDatasetDependents(
    deleteTarget?.id ?? null,
  )
  const [deleting, setDeleting] = useState(false)
  const [page, setPage] = useState(1)

  // A filter narrowed the list to zero, vs. there being no datasets at all —
  // these need different empty-state copy and CTA visibility.
  const isFiltered =
    datasets.length > 0 && filteredDatasets.length < datasets.length

  const totalPages = Math.max(1, Math.ceil(filteredDatasets.length / PER_PAGE))

  // No reset-on-every-filter-change effect: `useDatasets` awaits a full
  // `refetch()` after every create/delete/update, which gives
  // `filteredDatasets` a new identity on each mutation — an effect keyed on
  // it would bounce the user back to page 1 on every Duplicate or Delete.
  // But `page` still needs to track `totalPages` shrinking, or it goes
  // stale: delete the last row on page 2 and `page` keeps holding 2, so a
  // later Duplicate that regrows the list silently snaps the user back to a
  // page they were never viewing. This adjusts `page` in the same render
  // `totalPages` changes in — React's "adjust state while rendering"
  // pattern, not an effect, so it can't trip react-hooks/set-state-in-effect.
  const [prevTotalPages, setPrevTotalPages] = useState(totalPages)
  if (totalPages !== prevTotalPages) {
    setPrevTotalPages(totalPages)
    if (page > totalPages) setPage(totalPages)
  }

  const safePage = Math.min(page, totalPages)
  const pageItems = filteredDatasets.slice(
    (safePage - 1) * PER_PAGE,
    safePage * PER_PAGE,
  )

  if (filteredDatasets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/20 py-20 text-center">
        <span className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <FolderGit2 className="h-6 w-6" />
        </span>
        <p className="text-sm font-semibold">
          {isFiltered ? 'No datasets match your filters' : 'No datasets found'}
        </p>
        <p className="mx-auto max-w-72 text-xs text-muted-foreground">
          {isFiltered
            ? 'Try a different search term or workspace.'
            : 'Create a dataset from your connected sources to begin your modeling workflow.'}
        </p>
        {!isFiltered && (
          <Button
            size="sm"
            variant="outline"
            className="mt-4"
            onClick={onCreateDataset}
          >
            Create Dataset
          </Button>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="space-y-6">
        <div className="space-y-3">
          {pageItems.map(d => {
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

        <ListPagination
          currentPage={safePage}
          totalPages={totalPages}
          onPageChange={setPage}
        />
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
        sourcesLoading={sourcesLoading}
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

          {/* DS-LAKE-030-T02. The dependents, NAMED. A model keeps serving
              after its dataset is deleted — it holds its own pinned GOLD
              object — so this is a warning, not a refusal (D01), and Delete
              below stays enabled in every branch including the error one. */}
          {dependentsState === 'loading' && (
            <p className="text-xs text-muted-foreground">
              Checking which models use this dataset…
            </p>
          )}
          {dependentsState === 'error' && (
            <p className="text-xs text-muted-foreground">
              Could not check which models use this dataset. You can still
              delete it.
            </p>
          )}
          {dependentsState === 'ready' && dependents.length > 0 && (
            <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-xs font-medium text-foreground">
                {dependents.length} model
                {dependents.length === 1 ? '' : 's'} use
                {dependents.length === 1 ? 's' : ''} this dataset
              </p>
              <ul className="space-y-1">
                {dependents.map(model => (
                  <li
                    key={model.id}
                    className="flex items-center justify-between gap-3 text-xs"
                  >
                    <span className="truncate text-foreground">
                      {model.name}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {/* Plain words, not the monitoring palette: this is a
                          "how much will you care" hint, and borrowing the
                          red/amber status vocabulary here would assert a
                          health verdict this dialog never computed. */}
                      {model.scheduleEnabled
                        ? 'running'
                        : model.hasProductionVersion
                          ? 'deployed'
                          : 'not deployed'}
                      {/* Only worth saying when it is the ONLY reason the
                          model is listed — otherwise the current pointer
                          already explains why it is here. */}
                      {model.viaPinnedVersion && !model.viaCurrentPointer && (
                        <span className="ml-1 opacity-70">
                          · pinned by a saved version
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                They keep running on the data they were trained with, but lose
                their link back to this dataset — retraining from it will no
                longer be possible.
              </p>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={async event => {
                // DS-LAKE-030-T03. The dialog used to close itself and toast
                // success in the same tick as an unawaited `void` call, so a
                // failed delete said "Dataset deleted". Held open until the
                // request resolves, and the toast now reports what actually
                // happened.
                event.preventDefault()
                if (!deleteTarget) return
                setDeleting(true)
                try {
                  await onDeleteDataset(deleteTarget.id)
                  toast.success('Dataset deleted')
                  setDeleteTarget(null)
                } catch {
                  toast.error('Could not delete dataset')
                } finally {
                  setDeleting(false)
                }
              }}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
