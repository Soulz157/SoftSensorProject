'use client'

import { Database, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useDataStudio } from '@/hooks/dataset/use-data-studio'
import { AddConnectionDialog } from '@/app/(default)/data-studio/create/components/add-connection-dialog'
import { StudioFilterBar } from '@/app/(default)/data-studio/components/studio-filter-bar'
import { DataSourcesTab } from '@/app/(default)/data-studio/components/data-sources-tab'

export default function DataSourcesPage() {
  const s = useDataStudio()

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      {/* ── Header ── */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
            <Database className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Data Sources
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Connect and manage external systems where your data lives.
            </p>
          </div>
        </div>

        <Button
          size="sm"
          onClick={() => s.setDialogOpen(true)}
          className="cursor-pointer"
        >
          <Plus className="mr-1.5 h-4 w-4" /> Add New Source
        </Button>
      </div>

      <StudioFilterBar
        activeTab="datasources"
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
            Showing {s.filteredSources.length} of {s.allSources.length} sources
          </p>
          <button
            onClick={s.handleClearFilters}
            className="underline underline-offset-2 hover:text-foreground"
          >
            Clear all filters
          </button>
        </div>
      )}

      <DataSourcesTab
        loading={s.loading}
        filteredSources={s.filteredSources}
        connectedCount={s.connectedCount}
        offlineCount={s.offlineCount}
        hasFilter={s.hasFilter}
        onEditSource={s.setEditingSource}
        onDeleteSource={id => void s.deleteSource(id)}
        onAddConnection={() => s.setDialogOpen(true)}
      />

      {/* ── Dialogs ── */}
      <AddConnectionDialog
        open={s.dialogOpen}
        onOpenChange={s.setDialogOpen}
        onSave={() => void s.refetch()}
      />
      <AddConnectionDialog
        open={s.editingSource !== null}
        onOpenChange={open => {
          if (!open) s.setEditingSource(null)
        }}
        onSave={() => {
          void s.refetch()
          s.setEditingSource(null)
        }}
        sourceId={s.editingSource?.id}
        initialData={s.editingSource ?? undefined}
      />
    </div>
  )
}
