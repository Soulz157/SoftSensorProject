'use client'

import { Check, Pencil, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SavedDataSource } from '@/lib/mock-data-sources'
import { KIND_META } from './add-connection-dialog'

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
          <div className="min-w-0 ">
            <p className="truncate text-sm font-semibold text-foreground">
              {source.name}
            </p>
          </div>

          <p className="text-[11px] font-medium text-muted-foreground">
            {label}
          </p>
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
      <div className="space-y-0.5 ">
        <p className="break-all truncate font-mono text-xs text-foreground">
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
