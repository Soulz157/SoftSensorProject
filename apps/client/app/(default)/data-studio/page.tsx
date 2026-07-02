'use client'

import { useAtom } from 'jotai'
import { useMemo, useState } from 'react'
import {
  Check,
  Database,
  FolderPlus,
  Layers,
  Loader2,
  Plus,
  Search,
  SlidersHorizontal,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  dsSearchAtom,
  dsTypeFilterAtom,
  dsStatusFilterAtom,
} from '@/store/data-sources'
import { SourceCard } from '@/app/(default)/models/create/components/data-source-picker'
import {
  AddConnectionDialog,
  KIND_META,
} from '@/app/(default)/models/create/components/add-connection-dialog'
import { useDataSources } from '@/hooks/use-data-sources'
import type { DataSourceKind } from '@/lib/mock-data-sources'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// StatCard
// ---------------------------------------------------------------------------
function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string | number
  sub?: string
  accent?: 'emerald' | 'blue' | 'amber'
}) {
  const accentClass =
    {
      emerald: 'text-emerald-600 dark:text-emerald-400',
      blue: 'text-blue-600 dark:text-blue-400',
      amber: 'text-amber-600 dark:text-amber-400',
    }[accent ?? 'blue'] ?? 'text-foreground'

  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${accentClass}`}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SelectableSourceCard — wraps SourceCard with a checkbox overlay
// ---------------------------------------------------------------------------
function SelectableSourceCard({
  source,
  selected,
  onToggle,
  onEdit,
  onDelete,
}: {
  source: ReturnType<typeof useDataSources>['sources'][0]
  selected: boolean
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="relative">
      {/* Checkbox hit area — top-left corner */}
      <button
        type="button"
        onClick={onToggle}
        aria-label={selected ? 'Deselect source' : 'Select source'}
        className={cn(
          'absolute left-2.5 top-2.5 z-10 flex h-5 w-5 items-center justify-center',
          'rounded-md border-2 transition-all',
          selected
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-muted-foreground/40 bg-background hover:border-primary',
        )}
      >
        {selected && <Check className="h-3 w-3" strokeWidth={3} />}
      </button>

      {/* Ring highlight when selected */}
      <div
        className={cn(
          'rounded-xl transition-shadow duration-150',
          selected && 'ring-2 ring-primary ring-offset-1',
        )}
      >
        <SourceCard
          source={source}
          selected={false}
          onSelect={onToggle}
          onEdit={onEdit}
          onDelete={onDelete}
          multiple={false}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// CreateDatasetDialog
// ---------------------------------------------------------------------------
function CreateDatasetDialog({
  open,
  onOpenChange,
  selectedSources,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  selectedSources: ReturnType<typeof useDataSources>['sources']
  onConfirm: (name: string, description: string) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  const handleConfirm = async () => {
    if (!name.trim()) return
    setSaving(true)
    // simulate async save — replace with real API call
    await new Promise(r => setTimeout(r, 800))
    setSaving(false)
    onConfirm(name.trim(), description.trim())
    setName('')
    setDescription('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            Create Dataset
          </DialogTitle>
          <DialogDescription>
            Combine{' '}
            <span className="font-medium text-foreground">
              {selectedSources.length} source
              {selectedSources.length !== 1 ? 's' : ''}
            </span>{' '}
            into a reusable dataset for your models.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Dataset name */}
          <div className="space-y-1.5">
            <Label htmlFor="ds-name" className="text-xs font-medium">
              Dataset name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="ds-name"
              placeholder="e.g. Reactor Sensors Q2 2025"
              value={name}
              onChange={e => setName(e.target.value)}
              className="h-9 text-sm"
              autoFocus
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="ds-desc" className="text-xs font-medium">
              Description{' '}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </Label>
            <Textarea
              id="ds-desc"
              placeholder="What data does this dataset contain?"
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="min-h-[72px] resize-none text-sm"
            />
          </div>

          {/* Selected sources summary */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium">Included sources</p>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border bg-muted/40 p-2">
              {selectedSources.map(s => {
                const meta = KIND_META[s.type as DataSourceKind]
                const Icon = meta?.icon ?? Database
                return (
                  <div
                    key={s.id}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs"
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="font-medium">{s.name}</span>
                    <span className="text-muted-foreground">· {s.host}</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        'ml-auto shrink-0 px-1.5 py-0 text-[10px]',
                        s.status === 'connected'
                          ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                          : 'border-amber-500/30 text-amber-600 dark:text-amber-400',
                      )}
                    >
                      {s.status === 'connected' ? 'Online' : 'Offline'}
                    </Badge>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!name.trim() || saving}
            onClick={handleConfirm}
            className="gap-1.5"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FolderPlus className="h-3.5 w-3.5" />
            )}
            {saving ? 'Creating…' : 'Create Dataset'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// DataSourcesPage
// ---------------------------------------------------------------------------
export default function DataSourcesPage() {
  const {
    sources: allSources,
    loading,
    refetch,
    deleteSource,
  } = useDataSources()
  const [search, setSearch] = useAtom(dsSearchAtom)
  const [typeFilter, setTypeFilter] = useAtom(dsTypeFilterAtom)
  const [statusFilter, setStatusFilter] = useAtom(dsStatusFilterAtom)

  // Connection dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingSource, setEditingSource] = useState<
    (typeof allSources)[0] | null
  >(null)

  // ── Multi-select & Dataset state ──────────────────────────────────────────
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [datasetDialogOpen, setDatasetDialogOpen] = useState(false)

  const selectedSources = useMemo(
    () => allSources.filter(s => selectedIds.has(s.id)),
    [allSources, selectedIds],
  )

  const toggleSelect = (id: string) =>
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const enterSelectMode = () => {
    setSelectMode(true)
    setSelectedIds(new Set())
  }

  const exitSelectMode = () => {
    setSelectMode(false)
    setSelectedIds(new Set())
  }

  const handleDatasetCreated = (name: string, _description: string) => {
    // TODO: persist to backend
    console.log('Dataset created:', name, 'from sources:', [...selectedIds])
    setDatasetDialogOpen(false)
    exitSelectMode()
  }

  // ── Filtering ─────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return allSources.filter(s => {
      const matchesSearch =
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.host.toLowerCase().includes(q) ||
        s.createdBy.toLowerCase().includes(q)
      const matchesType = typeFilter === 'all' || s.type === typeFilter
      const matchesStatus = statusFilter === 'all' || s.status === statusFilter
      return matchesSearch && matchesType && matchesStatus
    })
  }, [allSources, search, typeFilter, statusFilter])

  const connectedCount = allSources.filter(s => s.status === 'connected').length
  const offlineCount = allSources.length - connectedCount
  const hasFilter =
    search !== '' || typeFilter !== 'all' || statusFilter !== 'all'

  const handleClearFilters = () => {
    setSearch('')
    setTypeFilter('all')
    setStatusFilter('all')
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        {/* ── Header ── */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Database className="h-6 w-6" />
            </span>
            <div>
              <h1 className="text-xl font-semibold text-foreground">
                Data Sources Integration
              </h1>
              <p className="text-sm text-muted-foreground">
                Manage connections to PI/AVEVA, SQL databases, REST APIs, and
                CSV uploads.
              </p>
            </div>
          </div>

          {/* CTA buttons — swap when in select mode */}
          <div className="flex items-center gap-2">
            {selectMode ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 gap-1.5"
                  onClick={exitSelectMode}
                >
                  <X className="h-3.5 w-3.5" />
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="h-9 gap-1.5"
                  disabled={selectedIds.size === 0}
                  onClick={() => setDatasetDialogOpen(true)}
                >
                  <Layers className="h-3.5 w-3.5" />
                  Create Dataset
                  {selectedIds.size > 0 && (
                    <Badge
                      variant="secondary"
                      className="ml-0.5 h-4 min-w-4 px-1 text-[10px]"
                    >
                      {selectedIds.size}
                    </Badge>
                  )}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 gap-1.5"
                  onClick={enterSelectMode}
                  disabled={allSources.length === 0}
                >
                  <Layers className="h-3.5 w-3.5" />
                  Create Dataset
                </Button>
                <Button
                  size="sm"
                  className="h-9 gap-1.5"
                  onClick={() => setDialogOpen(true)}
                >
                  <Plus className="h-4 w-4" />
                  Add Connection
                </Button>
              </>
            )}
          </div>
        </div>

        {/* ── Select-mode instruction banner ── */}
        {selectMode && (
          <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm text-primary">
            <Check className="h-4 w-4 shrink-0" />
            <span>
              Select the data sources you want to combine into a dataset.
              {selectedIds.size > 0 && (
                <span className="ml-1 font-semibold">
                  {selectedIds.size} selected.
                </span>
              )}
            </span>
            {filtered.length > 1 && (
              <button
                type="button"
                className="ml-auto shrink-0 text-xs underline underline-offset-2 hover:no-underline"
                onClick={() => setSelectedIds(new Set(filtered.map(s => s.id)))}
              >
                Select all ({filtered.length})
              </button>
            )}
          </div>
        )}

        {/* ── Stats row ── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="Total connections"
            value={allSources.length}
            accent="blue"
          />
          <StatCard
            label="Online"
            value={connectedCount}
            sub={`${Math.round((connectedCount / Math.max(allSources.length, 1)) * 100)}% available`}
            accent="emerald"
          />
          <StatCard label="Offline" value={offlineCount} accent="amber" />
          <StatCard
            label="Source types"
            value={new Set(allSources.map(s => s.type)).size}
            sub="of 4 supported"
            accent="blue"
          />
        </div>

        {/* ── Search + Filter bar ── */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-50 flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-9 pl-8 text-sm"
              placeholder="Search by name, host, or owner…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-1">
            {(['all', 'connected', 'offline'] as const).map(f => (
              <Button
                key={f}
                type="button"
                onClick={() => setStatusFilter(f)}
                className={`flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${
                  statusFilter === f
                    ? f === 'connected'
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : f === 'offline'
                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                        : 'bg-foreground text-background'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {f === 'connected' && <Wifi className="h-3 w-3" />}
                {f === 'offline' && <WifiOff className="h-3 w-3" />}
                {f === 'all' ? 'All' : f === 'connected' ? 'Online' : 'Offline'}
              </Button>
            ))}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={typeFilter !== 'all' ? 'default' : 'outline'}
                size="sm"
                className="h-9 gap-1.5"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {typeFilter === 'all'
                  ? 'Type'
                  : KIND_META[typeFilter as DataSourceKind].label}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel className="text-xs">
                Filter by type
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={typeFilter}
                onValueChange={v => setTypeFilter(v as typeof typeFilter)}
              >
                <DropdownMenuRadioItem value="all" className="text-xs">
                  All types
                </DropdownMenuRadioItem>
                {(Object.keys(KIND_META) as DataSourceKind[]).map(k => {
                  const { icon: Icon, label } = KIND_META[k]
                  return (
                    <DropdownMenuRadioItem
                      key={k}
                      value={k}
                      className="gap-2 text-xs"
                    >
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                      {label}
                    </DropdownMenuRadioItem>
                  )
                })}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          {hasFilter && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 text-xs text-muted-foreground"
              onClick={handleClearFilters}
            >
              Clear filters
            </Button>
          )}
        </div>

        {hasFilter && (
          <p className="text-xs text-muted-foreground">
            Showing {filtered.length} of {allSources.length} connections
          </p>
        )}

        {/* ── Content grid ── */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map(source =>
              selectMode ? (
                <SelectableSourceCard
                  key={source.id}
                  source={source}
                  selected={selectedIds.has(source.id)}
                  onToggle={() => toggleSelect(source.id)}
                  onEdit={() => setEditingSource(source)}
                  onDelete={() => void deleteSource(source.id)}
                />
              ) : (
                <SourceCard
                  key={source.id}
                  source={source}
                  selected={false}
                  onSelect={() => {}}
                  onEdit={() => setEditingSource(source)}
                  onDelete={() => void deleteSource(source.id)}
                  multiple={false}
                />
              ),
            )}
          </div>
        ) : allSources.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-border py-16 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Database className="h-6 w-6" />
            </span>
            <div className="space-y-1">
              <p className="text-sm font-semibold">No connections yet</p>
              <p className="mx-auto max-w-60 text-xs text-muted-foreground">
                Add your first data source to start pulling sensor data into
                models.
              </p>
            </div>
            <Button onClick={() => setDialogOpen(true)} className="gap-1.5">
              <Plus className="h-4 w-4" />
              Add Connection
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-12 text-center">
            <Search className="h-8 w-8 text-muted-foreground/40" />
            <div className="space-y-1">
              <p className="text-sm font-medium">No results found</p>
              <p className="text-xs text-muted-foreground">
                Try adjusting your search or filters.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={handleClearFilters}>
              Clear filters
            </Button>
          </div>
        )}
      </div>

      {/* ── Sticky bottom bar (select mode only) ── */}
      {selectMode && (
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 shadow-lg backdrop-blur-sm">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
            <p className="text-sm text-muted-foreground">
              {selectedIds.size === 0 ? (
                'Select data sources above to build a dataset.'
              ) : (
                <>
                  <span className="font-semibold text-foreground">
                    {selectedIds.size}
                  </span>{' '}
                  source{selectedIds.size !== 1 ? 's' : ''} selected
                </>
              )}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={exitSelectMode}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-8 gap-1.5 text-xs"
                disabled={selectedIds.size === 0}
                onClick={() => setDatasetDialogOpen(true)}
              >
                <FolderPlus className="h-3.5 w-3.5" />
                Create Dataset
                {selectedIds.size > 0 && `· ${selectedIds.size}`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Dialogs ── */}
      <AddConnectionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSave={() => void refetch()}
      />
      <AddConnectionDialog
        open={editingSource !== null}
        onOpenChange={open => {
          if (!open) setEditingSource(null)
        }}
        onSave={() => {
          void refetch()
          setEditingSource(null)
        }}
        sourceId={editingSource?.id}
        initialData={editingSource ?? undefined}
      />
      <CreateDatasetDialog
        open={datasetDialogOpen}
        onOpenChange={setDatasetDialogOpen}
        selectedSources={selectedSources}
        onConfirm={handleDatasetCreated}
      />
    </>
  )
}
