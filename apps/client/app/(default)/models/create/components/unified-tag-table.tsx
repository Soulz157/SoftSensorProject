'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
import { cn } from '@/lib/utils'
import {
  useUnifiedTagTable,
  type UnifiedTagRow,
} from '@/hooks/model/use-unified-tag-table'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'
import { SourcePickerSheet } from './source-configs/source-picker-sheet'

type StatusFilter = 'all' | 'good' | 'error'

interface Props {
  nav: UsePipelineNavResult
}

function ConstantValueInput({
  value,
  onCommit,
}: {
  value: number | undefined
  onCommit: (v: number | null) => void
}) {
  const [draft, setDraft] = useState(value?.toString() ?? '')

  useEffect(() => {
    setDraft(value?.toString() ?? '')
  }, [value])

  return (
    <Input
      type="text"
      inputMode="decimal"
      value={draft}
      placeholder="Set value"
      onChange={e => {
        const raw = e.target.value
        setDraft(raw)
        if (raw.trim() === '') {
          onCommit(null)
          return
        }
        const n = Number(raw)
        if (!Number.isNaN(n)) onCommit(n)
      }}
      className="w-24 h-7   bg-transparent font-mono text-xs text-foreground outline-none  "
    />
  )
}

function BulkActionBar({
  count,
  revalidating,
  onClear,
  onRevalidate,
  onDeleteClick,
}: {
  count: number
  revalidating: boolean
  onClear: () => void
  onRevalidate: () => void
  onDeleteClick: () => void
}) {
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 animate-in fade-in-0 slide-in-from-top-1">
      <span className="text-xs font-medium text-foreground">
        {count} tag{count === 1 ? '' : 's'} selected
      </span>
      <button
        type="button"
        onClick={onClear}
        className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
        Clear selection
      </button>

      <div className="ml-auto flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRevalidate}
          disabled={revalidating}
          className="gap-1.5"
        >
          {revalidating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Refresh
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onDeleteClick}
          className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
      </div>
    </div>
  )
}

export function UnifiedTagTable({ nav }: Props) {
  const {
    rows,
    addRow,
    deleteRow,
    renameRow,
    uploadCompare,
    isConstantEditable,
    getConstant,
    setConstant,
  } = useUnifiedTagTable(nav)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [revalidating, setRevalidating] = useState(false)
  const editInputRef = useRef<HTMLInputElement>(null)
  const compareFileRef = useRef<HTMLInputElement>(null)
  const headerCheckboxRef = useRef<HTMLInputElement>(null)

  const goodTags = rows.filter(r => r.status === 'good').map(r => r.tagName)
  const selectedRows = rows.filter(r => selectedIds.has(r.id))
  const selectedCount = selectedRows.length

  const toggleRow = (id: string) =>
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const clearSelection = () => setSelectedIds(new Set())

  const setNavFetch = nav.setFetchTagOverride

  useEffect(() => {
    if (selectedIds.size === 0) {
      setNavFetch(null)
      return
    }
    const selectedGoodTags = rows
      .filter(r => r.status === 'good' && selectedIds.has(r.id))
      .map(r => r.tagName)
    setNavFetch(
      selectedGoodTags.length === goodTags.length ? null : selectedGoodTags,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, rows, setNavFetch])

  const filteredRows = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()
    return rows.filter(r => {
      const matchesSearch = !q || r.tagName.toLowerCase().includes(q)
      const matchesStatus = statusFilter === 'all' || r.status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [rows, searchQuery, statusFilter])

  const allFilteredSelected =
    filteredRows.length > 0 && filteredRows.every(r => selectedIds.has(r.id))
  const someFilteredSelected =
    filteredRows.some(r => selectedIds.has(r.id)) && !allFilteredSelected

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = someFilteredSelected
    }
  }, [someFilteredSelected])

  const toggleAllFiltered = () =>
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (allFilteredSelected) {
        for (const r of filteredRows) next.delete(r.id)
      } else {
        for (const r of filteredRows) next.add(r.id)
      }
      return next
    })

  useEffect(() => {
    if (editingId) {
      editInputRef.current?.focus()
      editInputRef.current?.select()
    }
  }, [editingId])

  const handleAddRow = useCallback(() => {
    const newId = addRow()
    setEditingId(newId)
    setEditValue('')
  }, [addRow])

  const startEdit = useCallback((row: UnifiedTagRow) => {
    setEditingId(row.id)
    setEditValue(row.tagName)
  }, [])

  const commitEdit = useCallback(
    (row: UnifiedTagRow) => {
      renameRow(row, editValue)
      setEditingId(null)
    },
    [editValue, renameRow],
  )

  const cancelEdit = useCallback(() => setEditingId(null), [])

  const bulkDelete = () => {
    selectedRows.forEach(deleteRow)
    clearSelection()
    setConfirmDeleteOpen(false)
  }

  const bulkRevalidate = () => {
    if (revalidating) return
    const n = selectedCount
    setRevalidating(true)
    setTimeout(() => {
      setRevalidating(false)
      toast.success(`Re-validated ${n} tag${n === 1 ? '' : 's'}`)
    }, 800)
  }

  const goodCount = rows.filter(r => r.status === 'good').length
  const errorCount = rows.filter(r => r.status === 'error').length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-45 flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search tags…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="h-8 pl-8 pr-8 text-xs"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Status filter pills */}
        <div className="flex items-center rounded-md border border-border p-0.5">
          {(['all', 'good', 'error'] as const).map(f => (
            <button
              key={f}
              type="button"
              onClick={() => setStatusFilter(f)}
              className={cn(
                'rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors',
                statusFilter === f
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f === 'all'
                ? `All (${rows.length})`
                : f === 'good'
                  ? `Good (${goodCount})`
                  : `Error (${errorCount})`}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAddRow}
          className="gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          Add New Tag
        </Button>

        <input
          ref={compareFileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) {
              uploadCompare(file)
              e.target.value = ''
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => compareFileRef.current?.click()}
          className="gap-1.5"
        >
          <Upload className="h-3.5 w-3.5" />
          Upload CSV
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setSourcePickerOpen(true)}
          className="gap-1.5"
        >
          <Settings2 className="h-3.5 w-3.5" />
          Data Sources
        </Button>

        {rows.length > 0 && (
          <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            {errorCount > 0 && (
              <span className="font-medium text-destructive">
                {errorCount} error{errorCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        )}
      </div>
      {selectedCount > 0 && (
        <BulkActionBar
          count={selectedCount}
          revalidating={revalidating}
          onClear={clearSelection}
          onRevalidate={bulkRevalidate}
          onDeleteClick={() => setConfirmDeleteOpen(true)}
        />
      )}

      {/* ── Table ────────────────────────────────────────────────────────────── */}
      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-10 text-center">
          <p className="text-sm font-medium text-muted-foreground">
            No tags yet
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Select a data source in Step 2, upload a CSV, or add tags manually.
          </p>
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-8 text-center">
          <p className="text-sm font-medium text-muted-foreground">
            No tags match
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('')
              setStatusFilter('all')
            }}
            className="mt-1 text-xs text-primary hover:underline"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10 pl-4 text-center">
                  <input
                    ref={headerCheckboxRef}
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleAllFiltered}
                    disabled={filteredRows.length === 0}
                    title="Select all visible tags"
                    className="h-3.5 w-3.5 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-40"
                  />
                </TableHead>
                <TableHead className="pl-2">Tag Name</TableHead>
                <TableHead>Data Source</TableHead>
                <TableHead className="w-32">Value</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-20 pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map(row => (
                <TableRow key={row.id}>
                  {/* Row selection */}
                  <TableCell className="pl-4 text-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(row.id)}
                      onChange={() => toggleRow(row.id)}
                      aria-label={`Select ${row.tagName}`}
                      className="h-3.5 w-3.5 cursor-pointer accent-primary"
                    />
                  </TableCell>

                  {/* Tag Name — inline editable */}
                  <TableCell className="pl-2 font-mono text-xs">
                    {editingId === row.id ? (
                      <input
                        ref={editInputRef}
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') commitEdit(row)
                          if (e.key === 'Escape') cancelEdit()
                        }}
                        onBlur={() => commitEdit(row)}
                        className="w-full rounded border border-primary bg-transparent px-2 py-0.5 font-mono text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
                      />
                    ) : (
                      <span
                        className={cn(
                          'block truncate',
                          row.status === 'error' && 'text-destructive',
                        )}
                        title={row.tagName}
                      >
                        {row.tagName}
                      </span>
                    )}
                  </TableCell>

                  {/* Data Source */}
                  <TableCell className="text-xs text-muted-foreground">
                    {row.dataSource}
                  </TableCell>

                  {/* Constant value — Manual / CSV tags only */}
                  <TableCell>
                    {isConstantEditable(row) ? (
                      <ConstantValueInput
                        value={getConstant(row)}
                        onCommit={v => setConstant(row, v)}
                      />
                    ) : (
                      <span
                        title="Value comes from the connected source"
                        className="text-xs text-muted-foreground"
                      >
                        —
                      </span>
                    )}
                  </TableCell>

                  {/* Status badge */}
                  <TableCell>
                    <span
                      title={row.errorReason}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
                        row.status === 'good'
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
                      )}
                    >
                      <span
                        className={cn(
                          'h-1.5 w-1.5 rounded-full',
                          row.status === 'good'
                            ? 'bg-emerald-500'
                            : 'bg-rose-500',
                        )}
                      />
                      {row.status === 'good' ? 'Good' : 'Error'}
                    </span>
                  </TableCell>

                  {/* Actions */}
                  <TableCell className="pr-4">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        title="Rename tag"
                        onClick={() => startEdit(row)}
                        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        title="Remove tag"
                        onClick={() => deleteRow(row)}
                        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <SourcePickerSheet
        open={sourcePickerOpen}
        onOpenChange={setSourcePickerOpen}
        nav={nav}
      />

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedCount} tag{selectedCount === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes the selected tag{selectedCount === 1 ? '' : 's'} from
              this model. You can add {selectedCount === 1 ? 'it' : 'them'} back
              later. This action can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={bulkDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
