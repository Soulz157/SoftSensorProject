'use client'

import { useRef, useState } from 'react'
import { Server, Database, FileUp, Globe, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { dataSourceService } from '@/services/data-sources'
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
import type { SavedDataSource, DataSourceKind } from '@/lib/mock-data-sources'

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
}

const EMPTY_FORM: NewSourceForm = {
  name: '',
  type: 'aveva',
  host: '',
  username: '',
  password: '',
  dbName: '',
}

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
      return { ...initialData, password: '' }
    }
    return EMPTY_FORM
  })

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next)
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
        })
        onSave(res.data)
      }
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
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
                  onChange={e => setForm(f => ({ ...f, host: e.target.value }))}
                  autoComplete="off"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
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
            </>
          )}
        </div>
        <DialogFooter>
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
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save & Connect'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
