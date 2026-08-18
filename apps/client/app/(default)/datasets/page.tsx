'use client'

import { Layers, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useDataStudio } from '@/hooks/dataset/use-data-studio'
import { StudioFilterBar } from '@/app/(default)/data-studio/components/studio-filter-bar'
import { DatasetsTab } from '@/app/(default)/data-studio/components/datasets-tab'
import { CreateDatasetDialog } from '@/app/(default)/data-studio/components/create-dataset-dialog'

export default function DatasetsPage() {
  const s = useDataStudio()

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      {/* ── Header ── */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
            <Layers className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Datasets
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Curated, cleaned subsets of tag data prepared for modeling.
            </p>
          </div>
        </div>

        <Button
          size="sm"
          className="cursor-pointer"
          onClick={() => s.setDatasetDialogOpen(true)}
        >
          <Plus className="mr-1.5 h-4 w-4" /> Create Dataset
        </Button>
      </div>

      <StudioFilterBar
        activeTab="datasets"
        search={s.search}
        setSearch={s.setSearch}
        workspaceFilter={s.workspaceFilter}
        setWorkspaceFilter={s.setWorkspaceFilter}
        workspaces={s.workspaces}
        statusFilter={s.statusFilter}
        setStatusFilter={s.setStatusFilter}
        typeFilter={s.typeFilter}
        setTypeFilter={s.setTypeFilter}
      />

      {s.hasFilter && (
        <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
          <p>
            Showing {s.filteredDatasets.length} of {s.datasets.length} datasets
          </p>
          <button
            onClick={s.handleClearFilters}
            className="underline underline-offset-2 hover:text-foreground"
          >
            Clear all filters
          </button>
        </div>
      )}

      <DatasetsTab
        datasets={s.datasets}
        filteredDatasets={s.filteredDatasets}
        getWorkspaceName={s.getWorkspaceName}
        getSourceName={s.getSourceName}
        getSourceMeta={s.getSourceMeta}
        onCreateDataset={() => s.setDatasetDialogOpen(true)}
        onDeleteDataset={s.deleteDataset}
        onRenameDataset={s.updateDataset}
        onEditDataset={s.handleDatasetEdit}
        onDuplicateDataset={s.handleDatasetDuplicate}
      />

      {/* ── Dialog ── */}
      <CreateDatasetDialog
        open={s.datasetDialogOpen}
        onOpenChange={s.setDatasetDialogOpen}
        onConfirm={s.handleDatasetCreated}
      />
    </div>
  )
}
