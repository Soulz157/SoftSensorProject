'use client'

import { useRef, useState } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import {
  Server,
  Database,
  FileUp,
  Globe,
  Check,
  Plus,
  Plug,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  dataSourceAtom,
  dataSourceCredentialsAtom,
  savedDataSourcesAtom,
  selectedSavedSourceIdAtom,
  type SavedDataSource,
} from '@/store/data-visualize'
import type { DataSourceKind } from '@/lib/mock-data-sources'

const KIND_META: Record<
  DataSourceKind,
  { icon: LucideIcon; label: string; placeholder: string }
> = {
  aveva: {
    icon: Server,
    label: 'AVEVA Connect',
    placeholder: 'PI Web API · AVEVA / OSIsoft',
  },
  sql: {
    icon: Database,
    label: 'SQL Database',
    placeholder: 'PostgreSQL · SQL Server · MySQL',
  },
  csv: {
    icon: FileUp,
    label: 'CSV Upload',
    placeholder: '.csv up to 50 MB · comma-delimited',
  },
  api: {
    icon: Globe,
    label: 'API Gateway',
    placeholder: 'REST · GraphQL · Webhook',
  },
}

interface NewSourceForm {
  name: string
  type: DataSourceKind
  host: string
  username: string
  password: string
  dbName: string
}

const EMPTY_FORM: NewSourceForm = {
  name: '',
  type: 'aveva',
  host: '',
  username: '',
  password: '',
  dbName: '',
}

function StatusBadge({ status }: { status: SavedDataSource['status'] }) {
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

function SourceCard({
  source,
  selected,
  onSelect,
}: {
  source: SavedDataSource
  selected: boolean
  onSelect: () => void
}) {
  const { icon: Icon, label } = KIND_META[source.type]

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'group relative flex flex-col gap-3 rounded-xl bg-card p-4 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected
          ? 'ring-2 ring-primary'
          : 'ring-1 ring-foreground/10 hover:bg-muted',
      )}
    >
      {/* Header row */}
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

      {/* Host / DB */}
      <div className="space-y-0.5">
        <p className="truncate font-mono text-xs text-foreground">
          {source.host}
          {source.dbName ? `/${source.dbName}` : ''}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {source.username}
        </p>
      </div>

      {/* Footer row */}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
        <StatusBadge status={source.status} />
        <p className="text-[11px] text-muted-foreground">
          {source.lastUsed} · {source.createdBy}
        </p>
      </div>
    </button>
  )
}

export function Step2DataSource() {
  const [savedSources, setSavedSources] = useAtom(savedDataSourcesAtom)
  const [selectedId, setSelectedId] = useAtom(selectedSavedSourceIdAtom)
  const setDataSource = useSetAtom(dataSourceAtom)
  const setCredentials = useSetAtom(dataSourceCredentialsAtom)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<NewSourceForm>(EMPTY_FORM)
  const csvInputRef = useRef<HTMLInputElement>(null)
  const [csvFile, setCsvFile] = useState<File | null>(null)

  const selectSource = (source: SavedDataSource) => {
    setSelectedId(source.id)
    setDataSource(source.type)
    setCredentials({
      host: source.host,
      username: source.username,
      password: source.password,
      dbName: source.dbName,
    })
  }

  const openDialog = () => {
    setForm(EMPTY_FORM)
    setCsvFile(null)
    setDialogOpen(true)
  }

  const saveAndConnect = () => {
    const newSource: SavedDataSource = {
      id: crypto.randomUUID(),
      name: form.name.trim(),
      type: form.type,
      host: form.host.trim(),
      username: form.username.trim(),
      password: '••••••',
      dbName: form.dbName.trim(),
      status: 'connected',
      lastUsed: new Date().toISOString().split('T')[0] ?? '',
      createdBy: 'You',
    }
    setSavedSources(prev => [...prev, newSource])
    selectSource(newSource)
    setDialogOpen(false)
  }

  const formValid =
    form.name.trim() !== '' &&
    (form.type === 'csv'
      ? csvFile !== null
      : form.host.trim() !== '' &&
        form.username.trim() !== '' &&
        form.password.trim() !== '')

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <h2 className="text-base font-semibold text-foreground">
            Saved connections
          </h2>
          <p className="text-sm text-muted-foreground">
            Select a pre-configured source to pull data from.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={openDialog}
          className="shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Fetch Parameter
        </Button>
      </div>

      {/* Source cards grid */}
      {savedSources.length > 0 ? (
        <div
          role="radiogroup"
          aria-label="Saved data sources"
          className="grid gap-3 sm:grid-cols-2"
        >
          {savedSources.map(source => (
            <SourceCard
              key={source.id}
              source={source}
              selected={selectedId === source.id}
              onSelect={() => selectSource(source)}
            />
          ))}
        </div>
      ) : (
        /* Empty state */
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Plug className="h-6 w-6" />
          </span>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              No saved connections
            </p>
            <p className="text-xs text-muted-foreground">
              Add your first fetch parameter to get started.
            </p>
          </div>
          <Button type="button" size="sm" onClick={openDialog}>
            <Plus className="h-3.5 w-3.5" />
            Add Fetch Parameter
          </Button>
        </div>
      )}

      {/* Add Fetch Parameter dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={open => !open && setDialogOpen(false)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Fetch Parameter</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            {/* Name */}
            <div className="grid gap-1.5">
              <Label htmlFor="fp-name">Connection name</Label>
              <Input
                id="fp-name"
                placeholder="e.g. Main Plant Historian"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                autoComplete="off"
              />
            </div>

            {/* Source type selector */}
            <div className="grid gap-1.5">
              <Label>Source type</Label>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(KIND_META) as DataSourceKind[]).map(kind => {
                  const { icon: Icon, label } = KIND_META[kind]
                  const active = form.type === kind
                  return (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, type: kind }))}
                      className={cn(
                        'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        active
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-card text-muted-foreground hover:bg-muted',
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* CSV: file picker */}
            {form.type === 'csv' ? (
              <>
                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={e => setCsvFile(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  onClick={() => csvInputRef.current?.click()}
                  className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-6 transition-colors hover:border-primary/50"
                >
                  <FileUp className="h-5 w-5 text-muted-foreground" />
                  {csvFile ? (
                    <p className="font-mono text-xs text-foreground">
                      {csvFile.name}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Click to choose a .csv file
                    </p>
                  )}
                </button>
              </>
            ) : (
              /* Credential fields for non-CSV sources */
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="fp-host">Host</Label>
                  <Input
                    id="fp-host"
                    placeholder={KIND_META[form.type].placeholder}
                    value={form.host}
                    onChange={e =>
                      setForm(f => ({ ...f, host: e.target.value }))
                    }
                    autoComplete="off"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="fp-username">Username</Label>
                    <Input
                      id="fp-username"
                      placeholder="e.g. admin"
                      value={form.username}
                      onChange={e =>
                        setForm(f => ({ ...f, username: e.target.value }))
                      }
                      autoComplete="username"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="fp-password">Password</Label>
                    <Input
                      id="fp-password"
                      type="password"
                      placeholder="••••••••"
                      value={form.password}
                      onChange={e =>
                        setForm(f => ({ ...f, password: e.target.value }))
                      }
                      autoComplete="current-password"
                    />
                  </div>
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="fp-dbname">
                    Database name{' '}
                    <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    id="fp-dbname"
                    placeholder="e.g. plant_db"
                    value={form.dbName}
                    onChange={e =>
                      setForm(f => ({ ...f, dbName: e.target.value }))
                    }
                    autoComplete="off"
                  />
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!formValid}
              onClick={saveAndConnect}
            >
              Save &amp; Connect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
