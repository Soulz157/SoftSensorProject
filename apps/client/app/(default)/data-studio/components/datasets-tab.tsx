'use client'

import { useState } from 'react'
import {
  Database,
  FolderGit2,
  LayoutGrid,
  MoreVertical,
  Pencil,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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

type Studio = ReturnType<typeof useDataStudio>

interface Props {
  datasets: Studio['datasets']
  filteredDatasets: Studio['filteredDatasets']
  getWorkspaceName: Studio['getWorkspaceName']
  getSourceName: Studio['getSourceName']
  onCreateDataset: () => void
  onDeleteDataset: (id: string) => Promise<void>
  onRenameDataset: (
    id: string,
    patch: Partial<CreateDatasetInput>,
  ) => Promise<void>
}

export function DatasetsTab({
  datasets,
  filteredDatasets,
  getWorkspaceName,
  getSourceName,
  onCreateDataset,
  onDeleteDataset,
  onRenameDataset,
}: Props) {
  const [renameTarget, setRenameTarget] = useState<SavedDataset | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SavedDataset | null>(null)

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
          const extraSources = d.sourceIds.length - 1
          return (
            <div
              key={d.id}
              className="group flex flex-col justify-between rounded-xl bg-card p-5 ring-1 ring-foreground/10 transition-shadow hover:ring-primary/50"
            >
              {/* 1. Header (Context & Identity) */}
              <div className="mb-4 flex items-start justify-between">
                <div className="flex flex-col gap-2 min-w-0">
                  {/* Workspace Indicator (อยู่ด้านบนเพื่อบอก Hierarchy) */}
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                    <LayoutGrid className="h-3.5 w-3.5" />
                    <span className="truncate">
                      {getWorkspaceName(d.workspaceId)}
                    </span>
                  </div>

                  {/* Dataset Name & Icon */}
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                      <FolderGit2 className="h-5 w-5" />
                    </div>
                    <h3 className="truncate text-base font-semibold text-foreground">
                      {d.name}
                    </h3>
                  </div>
                </div>

                {/* Action Menu */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Actions for ${d.name}`}
                      // Visible by default (touch + keyboard); on hover-capable
                      // pointers it fades in on card hover / focus. Stays shown
                      // while the menu is open. `after` expands the 32px control
                      // to a ~44px touch target without shifting layout.
                      className="relative shrink-0 text-muted-foreground transition-opacity after:absolute after:-inset-1.5 after:content-[''] hover:text-foreground data-[state=open]:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setRenameTarget(d)}>
                      <Pencil className="mr-2 h-3.5 w-3.5" />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setDeleteTarget(d)}
                    >
                      <Trash2 className="mr-2 h-3.5 w-3.5" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* 2. Details / Info (Law of Common Region) */}
              <div className="mb-4 grid grid-cols-2 gap-2 rounded-lg border border-border/50 bg-muted/30 p-3">
                <div>
                  <p className="mb-1 text-[10px] font-medium text-muted-foreground">
                    Rows
                  </p>
                  <p className="font-mono text-sm font-medium text-foreground">
                    {d.rowCount.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="mb-1 text-[10px] font-medium text-muted-foreground">
                    Tags
                  </p>
                  <p className="font-mono text-sm font-medium text-foreground">
                    {d.tags.length}
                  </p>
                </div>
              </div>

              {/* 3. Footer (Law of Proximity - รวมเรื่อง Data Source ไว้ด้วยกัน) */}
              <div className="mt-auto flex items-center justify-between border-t border-border pt-3 text-[11px] text-muted-foreground">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Database className="h-3.5 w-3.5 shrink-0 opacity-70" />
                  <span className="truncate">
                    {d.sourceIds.length === 0 ? (
                      'No source'
                    ) : (
                      <>
                        <span className="font-medium text-foreground">
                          {getSourceName(d.sourceIds[0]!)}
                        </span>
                        {extraSources > 0 && ` + ${extraSources} more`}
                      </>
                    )}
                  </span>
                </div>
                <span className="shrink-0">
                  {new Date(d.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          )
        })}
      </div>

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
