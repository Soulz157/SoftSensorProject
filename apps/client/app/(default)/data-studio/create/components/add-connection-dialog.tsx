'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Server,
  Database,
  FileUp,
  Globe,
  CheckCircle2,
  XCircle,
  Loader2,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { dataSourceService } from '@/services/data-sources'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type {
  SavedDataSource,
  DataSourceKind,
  DataSourceConfig,
} from '@/lib/mock-data-sources'

export const KIND_META: Record<
  DataSourceKind,
  { icon: LucideIcon; label: string; placeholder: string }
> = {
  aveva: {
    icon: Server,
    label: 'PI / AVEVA',
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
  config: DataSourceConfig
}

const EMPTY_FORM: NewSourceForm = {
  name: '',
  type: 'aveva',
  host: '',
  username: '',
  password: '',
  dbName: '',
  config: {},
}

type TestState = 'idle' | 'testing' | 'ok' | 'failed'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (source: SavedDataSource) => void
  /** When set, dialog runs in edit mode against this id */
  sourceId?: string
  /** Pre-fills form fields in edit mode */
  initialData?: {
    name: string
    type: DataSourceKind
    host: string
    username: string
    dbName: string
    config?: DataSourceConfig | null
  }
}

export function AddConnectionDialog({
  open,
  onOpenChange,
  onSave,
  sourceId,
  initialData,
}: Props) {
  const isEdit = Boolean(sourceId)
  const csvInputRef = useRef<HTMLInputElement>(null)
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<NewSourceForm>(() => {
    if (isEdit && initialData) {
      return { ...initialData, password: '', config: initialData.config ?? {} }
    }
    return EMPTY_FORM
  })
  const [testState, setTestState] = useState<TestState>('idle')
  const [testMessage, setTestMessage] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)

  // Re-seed the form whenever the dialog opens. The useState initializer only
  // runs on first mount, but this dialog instance is persistently mounted and
  // reused across sources (open toggled by the parent), so without this the
  // edit form would keep showing stale/blank values. Key off the open edge +
  // sourceId (stable per source) — not initialData's per-render identity.
  useEffect(() => {
    if (!open) return
    setForm(
      isEdit && initialData
        ? { ...initialData, password: '', config: initialData.config ?? {} }
        : EMPTY_FORM,
    )
    setCsvFile(null)
    setTestState('idle')
    setTestMessage('')
    setConfirmOpen(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sourceId])

  const setConfig = (patch: Partial<DataSourceConfig>) => {
    setForm(f => ({ ...f, config: { ...f.config, ...patch } }))
    setTestState('idle')
  }

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next)
  }

  const testConnection = async () => {
    setTestState('testing')
    setTestMessage('')
    try {
      const res = await dataSourceService.testAdHoc({
        type: form.type,
        host: form.host.trim(),
        username: form.username.trim(),
        password: form.password,
        dbName: form.dbName.trim(),
        config: form.config,
      })
      setTestState(res.data.ok ? 'ok' : 'failed')
      setTestMessage(res.data.message)
    } catch (err) {
      setTestState('failed')
      setTestMessage(
        err instanceof Error ? err.message : 'Connection test failed.',
      )
    }
  }

  const formValid = isEdit
    ? form.name.trim() !== ''
    : form.name.trim() !== '' &&
      (form.type === 'csv'
        ? csvFile !== null
        : form.host.trim() !== '' &&
          form.username.trim() !== '' &&
          form.password.trim() !== '')

  const save = async () => {
    setSaving(true)
    try {
      if (isEdit && sourceId) {
        const res = await dataSourceService.update(sourceId, {
          name: form.name.trim(),
          type: form.type,
          host: form.host.trim(),
          username: form.username.trim(),
          dbName: form.dbName.trim(),
          config: form.config,
          ...(form.password.trim() !== '' && {
            password: form.password.trim(),
          }),
        })
        onSave(res.data)
      } else {
        const res = await dataSourceService.create({
          name: form.name.trim(),
          type: form.type,
          host: form.host.trim(),
          username: form.username.trim(),
          password: form.password.trim(),
          dbName: form.dbName.trim(),
          config: form.config,
        })
        onSave(res.data)
      }
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {isEdit ? 'Edit Connection' : 'Add Data Connection'}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="mp-fp-name">Connection name</Label>
              <Input
                id="mp-fp-name"
                placeholder="e.g. Main Plant Historian"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                autoComplete="off"
              />
            </div>
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
                      onClick={() => {
                        setForm(f => ({ ...f, type: kind }))
                        setTestState('idle')
                      }}
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
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="mp-fp-host">Host</Label>
                  <Input
                    id="mp-fp-host"
                    placeholder={KIND_META[form.type].placeholder}
                    value={form.host}
                    onChange={e =>
                      setForm(f => ({ ...f, host: e.target.value }))
                    }
                    autoComplete="off"
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="mp-fp-username">Username</Label>
                    <Input
                      id="mp-fp-username"
                      placeholder="e.g. admin"
                      value={form.username}
                      onChange={e =>
                        setForm(f => ({ ...f, username: e.target.value }))
                      }
                      autoComplete="username"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="mp-fp-password">Password</Label>
                    <Input
                      id="mp-fp-password"
                      type="password"
                      placeholder={
                        isEdit ? 'Leave blank to keep current' : '••••••••'
                      }
                      value={form.password}
                      onChange={e =>
                        setForm(f => ({ ...f, password: e.target.value }))
                      }
                      autoComplete="current-password"
                    />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="mp-fp-dbname">
                    Database name{' '}
                    <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    id="mp-fp-dbname"
                    placeholder="e.g. plant_db"
                    value={form.dbName}
                    onChange={e =>
                      setForm(f => ({ ...f, dbName: e.target.value }))
                    }
                    autoComplete="off"
                  />
                </div>

                {form.type === 'sql' && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="grid gap-1.5">
                      <Label htmlFor="mp-fp-driver">Driver</Label>
                      <select
                        id="mp-fp-driver"
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        value={form.config.driver ?? 'postgres'}
                        onChange={e => setConfig({ driver: e.target.value })}
                      >
                        <option value="postgres">PostgreSQL</option>
                        <option value="mysql">MySQL</option>
                        <option value="mariadb">MariaDB</option>
                      </select>
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="mp-fp-port">Port</Label>
                      <Input
                        id="mp-fp-port"
                        type="number"
                        placeholder="5432"
                        value={form.config.port ?? ''}
                        onChange={e =>
                          setConfig({
                            port: e.target.value
                              ? Number(e.target.value)
                              : undefined,
                          })
                        }
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="mp-fp-schema">
                        Schema{' '}
                        <span className="text-muted-foreground">(opt.)</span>
                      </Label>
                      <Input
                        id="mp-fp-schema"
                        placeholder="public"
                        value={form.config.schema ?? ''}
                        onChange={e => setConfig({ schema: e.target.value })}
                      />
                    </div>
                  </div>
                )}

                {form.type === 'api' && (
                  <>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="grid gap-1.5">
                        <Label htmlFor="mp-fp-baseurl">
                          Base URL{' '}
                          <span className="text-muted-foreground">
                            (defaults to host)
                          </span>
                        </Label>
                        <Input
                          id="mp-fp-baseurl"
                          placeholder="https://api.example.com"
                          value={form.config.baseUrl ?? ''}
                          onChange={e => setConfig({ baseUrl: e.target.value })}
                          autoComplete="off"
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="mp-fp-endpoint">Endpoint path</Label>
                        <Input
                          id="mp-fp-endpoint"
                          placeholder="/v1/readings"
                          value={form.config.endpoint ?? ''}
                          onChange={e =>
                            setConfig({ endpoint: e.target.value })
                          }
                          autoComplete="off"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="grid gap-1.5">
                        <Label htmlFor="mp-fp-method">Method</Label>
                        <select
                          id="mp-fp-method"
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          value={form.config.method ?? 'GET'}
                          onChange={e => setConfig({ method: e.target.value })}
                        >
                          <option value="GET">GET</option>
                          <option value="POST">POST</option>
                        </select>
                      </div>
                      <div className="grid gap-1.5">
                        <Label htmlFor="mp-fp-auth">Auth</Label>
                        <select
                          id="mp-fp-auth"
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          value={form.config.authType ?? 'none'}
                          onChange={e =>
                            setConfig({ authType: e.target.value })
                          }
                        >
                          <option value="none">None</option>
                          <option value="basic">Basic (user/pass)</option>
                          <option value="bearer">Bearer token</option>
                          <option value="api_key">API key</option>
                        </select>
                      </div>
                    </div>
                    {form.config.authType === 'api_key' && (
                      <div className="grid gap-1.5">
                        <Label htmlFor="mp-fp-apikeyname">API key name</Label>
                        <Input
                          id="mp-fp-apikeyname"
                          placeholder="X-API-Key"
                          value={form.config.apiKeyName ?? ''}
                          onChange={e =>
                            setConfig({ apiKeyName: e.target.value })
                          }
                          autoComplete="off"
                        />
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      The secret above is the{' '}
                      {form.config.authType === 'bearer'
                        ? 'bearer token'
                        : form.config.authType === 'api_key'
                          ? 'API key value'
                          : 'password'}
                      .
                    </p>
                  </>
                )}
              </>
            )}
          </div>
          {testState !== 'idle' && form.type !== 'csv' && (
            <div
              className={cn(
                'flex items-start gap-2 rounded-md px-3 py-2 text-xs',
                testState === 'ok' &&
                  'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                testState === 'failed' && 'bg-destructive/10 text-destructive',
                testState === 'testing' && 'bg-muted text-muted-foreground',
              )}
            >
              {testState === 'testing' && (
                <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
              )}
              {testState === 'ok' && (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              )}
              {testState === 'failed' && (
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              )}
              <span className="break-words">
                {testState === 'testing'
                  ? 'Testing connection…'
                  : testMessage ||
                    (testState === 'ok'
                      ? 'Connection successful.'
                      : 'Connection failed.')}
              </span>
            </div>
          )}
          <DialogFooter>
            {form.type !== 'csv' && (
              <Button
                type="button"
                variant="outline"
                className="sm:mr-auto"
                disabled={testState === 'testing' || saving}
                onClick={() => void testConnection()}
              >
                {testState === 'testing' ? 'Testing…' : 'Test Connection'}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!formValid || saving}
              onClick={() => (isEdit ? setConfirmOpen(true) : void save())}
            >
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Save & Connect'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace connection details?</AlertDialogTitle>
            <AlertDialogDescription>
              This overwrites the saved “{form.name || 'connection'}” with the
              values above. Leaving the password blank keeps the current secret;
              entering a new one replaces it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={() => {
                setConfirmOpen(false)
                void save()
              }}
            >
              Replace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
