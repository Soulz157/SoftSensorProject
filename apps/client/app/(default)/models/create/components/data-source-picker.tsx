'use client'

import { useState } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { Check, Pencil, Plus, Plug, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  mpSavedDataSourcesAtom,
  mpSelectedSavedSourceIdAtom,
  mpSelectedSavedSourceIdsAtom,
  type SavedDataSource,
} from '@/store/model-pipeline'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'
import { AddConnectionDialog, KIND_META } from './add-connection-dialog'

export function StatusBadge({ status }: { status: SavedDataSource['status'] }) {
  if (status === 'connected') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Connected
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-500/10 px-2 py-0.5 text-[11px] font-medium text-zinc-500">
      <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
      Offline
    </span>
  )
}

export function SourceCard({
  source,
  selected,
  onSelect,
  onEdit,
  onDelete,
  multiple,
}: {
  source: SavedDataSource
  selected: boolean
  onSelect: () => void
  onEdit?: () => void
  onDelete?: () => void
  multiple?: boolean
}) {
  const { icon: Icon, label } = KIND_META[source.type]
  return (
    <div
      role={multiple ? 'checkbox' : 'radio'}
      aria-checked={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={e => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        'group relative flex cursor-pointer flex-col gap-3 rounded-xl bg-card p-4 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected
          ? 'ring-2 ring-primary'
          : 'ring-1 ring-foreground/10 hover:bg-muted',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors',
              selected
                ? 'bg-primary/15 text-primary'
                : 'bg-muted text-muted-foreground',
            )}
          >
            <Icon className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {source.name}
            </p>
            <p className="text-[11px] font-medium text-muted-foreground">
              {label}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {onEdit && (
            <button
              type="button"
              aria-label="Edit connection"
              onClick={e => {
                e.stopPropagation()
                onEdit()
              }}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              aria-label="Delete connection"
              onClick={e => {
                e.stopPropagation()
                onDelete()
              }}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          <span
            className={cn(
              'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors',
              selected
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border',
            )}
            aria-hidden="true"
          >
            {selected && <Check className="h-3 w-3" />}
          </span>
        </div>
      </div>
      <div className="space-y-0.5">
        <p className="truncate font-mono text-xs text-foreground">
          {source.host}
          {source.dbName ? `/${source.dbName}` : ''}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {source.username}
        </p>
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
        <StatusBadge status={source.status} />
        <p className="text-[11px] text-muted-foreground">
          {source.lastUsed} · {source.createdBy}
        </p>
      </div>
    </div>
  )
}

interface Props {
  nav: UsePipelineNavResult
  multiple?: boolean
}

export function DataSourcePicker({ nav, multiple }: Props) {
  const [savedSources, setSavedSources] = useAtom(mpSavedDataSourcesAtom)
  const selectedId = nav.selectedSavedSourceId
  const setSelectedIdAtom = useSetAtom(mpSelectedSavedSourceIdAtom)
  const [selectedIds, setSelectedIds] = useAtom(mpSelectedSavedSourceIdsAtom)

  const [dialogOpen, setDialogOpen] = useState(false)

  const handleSaveSource = (newSource: SavedDataSource) => {
    setSavedSources(prev => [...prev, newSource])
    if (multiple) {
      setSelectedIds(prev => [...prev, newSource.id])
    } else {
      setSelectedIdAtom(newSource.id)
      nav.setSelectedSavedSource(newSource)
    }
  }

  const handleSelect = (source: SavedDataSource) => {
    if (multiple) {
      setSelectedIds(prev =>
        prev.includes(source.id)
          ? prev.filter(id => id !== source.id)
          : [...prev, source.id],
      )
    } else {
      setSelectedIdAtom(source.id)
      nav.setSelectedSavedSource(source)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium text-foreground">Data source</p>
          <p className="text-xs text-muted-foreground">
            Select a PI, SQL, CSV, or API connection to pull data from.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => setDialogOpen(true)}
          className="shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Connection
        </Button>
      </div>

      {savedSources.length > 0 ? (
        <div
          role={multiple ? 'group' : 'radiogroup'}
          aria-label="Saved data sources"
          className="grid gap-3 sm:grid-cols-2"
        >
          {savedSources.map(source => {
            const isSelected = multiple
              ? selectedIds.includes(source.id)
              : selectedId === source.id

            return (
              <SourceCard
                key={source.id}
                source={source}
                selected={isSelected}
                onSelect={() => handleSelect(source)}
                multiple={multiple}
              />
            )
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-10 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Plug className="h-5 w-5" />
          </span>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              No saved connections
            </p>
            <p className="text-xs text-muted-foreground">
              Add your first connection to get started.
            </p>
          </div>
          <Button type="button" size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Add Connection
          </Button>
        </div>
      )}

      <AddConnectionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSave={handleSaveSource}
      />
    </div>
  )
}
