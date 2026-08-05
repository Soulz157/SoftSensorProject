'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { format } from 'date-fns'
import {
  AlertCircle,
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
  useDatasetTagTable,
  type DatasetTagRow,
} from '@/hooks/dataset/use-dataset-tag-table'
import {
  useDatasetTagMetadata,
  type TagQuality,
} from '@/hooks/dataset/use-dataset-tag-metadata'
import { UseDatasetPipelineNavResult } from '@/hooks/dataset/use-dataset-pipeline-nav'
import { dwFeaturePresetAtom, dwTargetTagAtom } from '@/store/dataset-studio'
import {
  planPresetApplication,
  planSdtaApplication,
} from '@/lib/feature-preset'
import { SourcePickerSheet } from './source-configs/source-picker-sheet'
import { PresetApplyManager } from './preset-apply-modal'

const QUALITY_META: Record<
  TagQuality,
  { label: string; dot: string; text: string }
> = {
  good: {
    label: 'Good',
    dot: 'bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400',
  },
  questionable: {
    label: 'Questionable',
    dot: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-400',
  },
  bad: {
    label: 'Bad',
    dot: 'bg-rose-500',
    text: 'text-rose-600 dark:text-rose-400',
  },
  unknown: {
    label: '—',
    dot: 'bg-muted-foreground/40',
    text: 'text-muted-foreground',
  },
}

function QualityBadge({ quality }: { quality: TagQuality }) {
  const q = QUALITY_META[quality]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-[11px] font-medium',
        q.text,
      )}
    >
      <span className={cn('h-2 w-2 rounded-full', q.dot)} />
      {q.label}
    </span>
  )
}

/**
 * PI snapshot time → compact local `yyyy-MM-dd HH:mm`. The raw ISO string stays
 * in the cell's `title`. Unparseable values render as `—` rather than
 * "Invalid Date".
 */
function formatSnapshotTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : format(d, 'yyyy-MM-dd HH:mm')
}

function BoolCell({ value }: { value: boolean | null | undefined }) {
  if (value === null || value === undefined)
    return <span className="text-muted-foreground">—</span>
  return (
    <span
      className={
        value ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
      }
    >
      {value ? 'Yes' : 'No'}
    </span>
  )
}

type StatusFilter = 'all' | 'good' | 'error'

interface Props {
  nav: UseDatasetPipelineNavResult
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
      className="h-7 w-24 bg-transparent font-mono text-xs text-foreground outline-none"
    />
  )
}

export function UnifiedTagTable({ nav }: Props) {
  // Real PI tag metadata (value / unit / point-type / quality), keyed by tag
  // name — metadata only, no archive read. Fills the columns when it resolves.
  // Declared first: the row builder needs its tag names so `originalName`
  // matches these keys.
  const {
    metaByTag,
    tagsBySource,
    loading: metaLoading,
    error: metaError,
  } = useDatasetTagMetadata()

  const {
    rows,
    deleteRow,
    renameRow,
    addRow,
    uploadCompare,
    isConstantEditable,
    getConstant,
    setConstant,
  } = useDatasetTagTable(nav, tagsBySource)

  const setFeaturePreset = useSetAtom(dwFeaturePresetAtom)
  const setTargetTag = useSetAtom(dwTargetTagAtom)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [revalidating, setRevalidating] = useState(false)
  const editInputRef = useRef<HTMLInputElement>(null)
  const compareFileRef = useRef<HTMLInputElement>(null)
  const headerCheckboxRef = useRef<HTMLInputElement>(null)
  const seenRowIdsRef = useRef<Set<string>>(new Set())

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

  // Reconcile checkbox selection with the current row set: drop ids for rows
  // that no longer exist (source removed / tag deleted) and auto-select any
  // brand-new good rows (source added) so a fresh table starts fully selected.
  // A `seen` ref distinguishes a genuinely new row from one the user unchecked.
  useEffect(() => {
    setSelectedIds(prev => {
      const validIds = new Set(rows.map(r => r.id))
      const next = new Set<string>()
      for (const id of prev) if (validIds.has(id)) next.add(id)
      for (const r of rows) {
        if (r.status === 'good' && !seenRowIdsRef.current.has(r.id))
          next.add(r.id)
      }
      return next
    })
    seenRowIdsRef.current = new Set(rows.map(r => r.id))
  }, [rows])

  const { setSelectedTags, setHasInvalidTags } = nav

  // Checkbox selection is the source of truth for the confirmed tag set that
  // the fetch step consumes. Sync it to the wizard store whenever it changes.
  useEffect(() => {
    const selectedGoodTags = rows
      .filter(r => r.status === 'good' && selectedIds.has(r.id))
      .map(r => r.tagName)
    const same =
      nav.selectedTags.length === selectedGoodTags.length &&
      nav.selectedTags.every((t, i) => t === selectedGoodTags[i])
    // setSelectedTags resets the downstream fetch — only call on a real change.
    if (!same) setSelectedTags(selectedGoodTags)
    setHasInvalidTags(
      rows.some(r => r.status === 'error' && selectedIds.has(r.id)),
    )
  }, [selectedIds, rows, nav.selectedTags, setSelectedTags, setHasInvalidTags])

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

  const handleAddRow = useCallback(() => {
    const newId = addRow()
    setEditingId(newId)
    setEditValue('')
  }, [addRow])

  useEffect(() => {
    if (editingId) {
      editInputRef.current?.focus()
      editInputRef.current?.select()
    }
  }, [editingId])

  const startEdit = useCallback((row: DatasetTagRow) => {
    setEditingId(row.id)
    setEditValue(row.tagName)
  }, [])

  const commitEdit = useCallback(
    (row: DatasetTagRow) => {
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
          onClick={toggleAllFiltered}
          className="cursor-pointer gap-1.5"
        >
          Select All
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAddRow}
          className="cursor-pointer gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          Add New Tag
        </Button>

        <input
          ref={compareFileRef}
          type="file"
          accept=".csv,text/csv"
          className="cursor-pointer hidden"
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
          className="cursor-pointer gap-1.5"
        >
          <Upload className="h-3.5 w-3.5" />
          Upload CSV
        </Button>

        {/* Rows, not tag names: the preset gate needs each row's status, and a
            `string[]` cannot tell a healthy tag from one in error. */}
        <PresetApplyManager
          rows={rows}
          onApplyPreset={applied => {
            const { document, summary, featureConfigs, requiredTags } = applied

            // Queue equations for Step 4. Appended, not replaced: Apply Preset
            // lives in Step 1, well before Step 4 is normally visited, but a
            // preset should augment manually authored features, not silently
            // discard them. Nothing evaluates yet — dwFeaturedDatasetAtom
            // derives from dwRawDatasetAtom, which is still empty here.
            nav.setFeatureConfigs(prev => [...prev, ...featureConfigs])

            // Union required base tags (+ target, when it resolves to a
            // healthy row) into the confirmed selection so Step 2 fetches
            // exactly what the preset needs.
            const plan = planPresetApplication(
              document,
              requiredTags,
              nav.selectedTags,
              rows,
            )
            nav.setSelectedTags(plan.selectedTags)
            setTargetTag(plan.targetTag)
            setFeaturePreset(summary)

            toast.success(
              `Applied ${document.name}. ${featureConfigs.length} equation(s) queued for Step 4.`,
            )
          }}
          onApplySdta={sdta => {
            const plan = planSdtaApplication(sdta, rows)

            // Time exclusions have no functional updater on nav — read then
            // write. Conditional rules do, so use it rather than duplicating
            // the read-then-write pattern for no reason.
            nav.setExclusions([...nav.exclusions, ...plan.exclusions])
            nav.setConditionalRules(prev => [...prev, ...plan.conditionalRules])

            if (plan.droppedConditions.length > 0) {
              toast.warning(
                `Applied cut config, but ${plan.droppedConditions.length} condition(s) were skipped: ` +
                  plan.droppedConditions
                    .map(d => `${d.tag} (${d.reason})`)
                    .join(', '),
              )
            } else {
              toast.success(
                `Applied ${plan.exclusions.length} exclusion window(s) and ${plan.conditionalRules.length} condition(s) at Step 3.`,
              )
            }
          }}
        />

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

        {metaLoading && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading tag metadata…
          </span>
        )}

        {/* Without this the only symptom of a failed or timed-out metadata
            call was a spinner that quietly stopped. */}
        {!metaLoading && metaError && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-destructive">
            <AlertCircle className="h-3.5 w-3.5" />
            {metaError}
          </span>
        )}

        {rows.length > 0 && errorCount > 0 && (
          <div className="ml-auto flex items-center gap-1.5 text-xs">
            <span className="font-medium text-destructive">
              {errorCount} error{errorCount !== 1 ? 's' : ''}
            </span>
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
            Tags are discovered from the data sources you selected for this
            dataset.
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
                <TableHead>Description</TableHead>
                <TableHead>Data Source</TableHead>
                <TableHead className="w-16">Unit</TableHead>
                <TableHead className="w-16 text-center">Quest.</TableHead>
                <TableHead className="w-16 text-center">Subst.</TableHead>
                <TableHead className="w-36">Timestamp</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="w-20 pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map(row => {
                const meta = metaByTag.get(row.originalName)
                return (
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
                      {/* Manual/CSV tags carry a user-set constant instead of a
                          live reading. The Value column is gone, so the editor
                          lives here — dropping it would break tag constants. */}
                      {isConstantEditable(row) && editingId !== row.id && (
                        <div className="mt-1 flex items-center gap-1.5">
                          <span className="text-[10px] text-muted-foreground">
                            Constant
                          </span>
                          <ConstantValueInput
                            value={getConstant(row)}
                            onCommit={v => setConstant(row, v)}
                          />
                        </div>
                      )}
                    </TableCell>

                    {/* Description (PI metadata) */}
                    <TableCell className="max-w-40 truncate text-xs text-muted-foreground">
                      <span title={meta?.description ?? undefined}>
                        {meta?.description ?? '—'}
                      </span>
                    </TableCell>

                    {/* Data Source */}
                    <TableCell className="text-xs text-muted-foreground">
                      {row.dataSource}
                    </TableCell>

                    {/* Unit */}
                    <TableCell className="text-xs text-muted-foreground">
                      {meta?.unit ?? '—'}
                    </TableCell>

                    {/* Questionable */}
                    <TableCell className="text-center text-xs">
                      <BoolCell value={meta?.questionable} />
                    </TableCell>

                    {/* Substituted */}
                    <TableCell className="text-center text-xs">
                      <BoolCell value={meta?.substituted} />
                    </TableCell>

                    {/* Timestamp — when this snapshot value was read from PI */}
                    <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                      <span title={meta?.timestamp ?? undefined}>
                        {formatSnapshotTime(meta?.timestamp)}
                      </span>
                    </TableCell>

                    {/* Status — real PI snapshot quality when the tag resolved.
                        A tag with no metadata keeps its own error state, so
                        "not found in historian" is never masked as unknown. */}
                    <TableCell>
                      {meta ? (
                        <QualityBadge quality={meta.quality} />
                      ) : (
                        <span
                          title={row.errorReason}
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
                            row.status === 'good'
                              ? 'bg-muted text-muted-foreground'
                              : 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
                          )}
                        >
                          <span
                            className={cn(
                              'h-1.5 w-1.5 rounded-full',
                              row.status === 'good'
                                ? 'bg-muted-foreground/40'
                                : 'bg-rose-500',
                            )}
                          />
                          {row.status === 'good' ? 'No data' : 'Error'}
                        </span>
                      )}
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
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <SourcePickerSheet
        open={sourcePickerOpen}
        onOpenChange={setSourcePickerOpen}
      />

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedCount} tag{selectedCount === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes the selected tag{selectedCount === 1 ? '' : 's'} from
              this dataset. You can add {selectedCount === 1 ? 'it' : 'them'}{' '}
              back later. This action can&apos;t be undone.
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
