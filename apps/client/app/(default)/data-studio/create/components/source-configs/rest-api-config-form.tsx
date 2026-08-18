'use client'

import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { RestApiConfig } from '@/store/model-pipeline'

interface Props {
  config: RestApiConfig
  onChange: (config: RestApiConfig) => void
  disabled?: boolean
}

export function RestApiConfigForm({ config, onChange, disabled }: Props) {
  const set = <K extends keyof RestApiConfig>(
    key: K,
    value: RestApiConfig[K],
  ) => onChange({ ...config, [key]: value })

  const headerEntries = Object.entries(config.headers)

  const setHeader = (idx: number, key: string, value: string) => {
    const next = { ...config.headers }
    const oldKey = headerEntries[idx]?.[0] ?? ''
    if (oldKey && oldKey !== key) delete next[oldKey]
    if (key) next[key] = value
    set('headers', next)
  }

  const addHeader = () => set('headers', { ...config.headers, '': '' })

  const removeHeader = (key: string) => {
    const next = { ...config.headers }
    delete next[key]
    set('headers', next)
  }

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-[80px_1fr] gap-2">
        <div className="grid gap-1.5">
          <Label className="text-xs">Method</Label>
          <Input
            readOnly
            disabled={disabled}
            className="h-7 cursor-default border-transparent bg-muted/50 text-center font-mono text-xs text-muted-foreground shadow-none focus-visible:ring-0"
            value={config.method}
          />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">URL</Label>
          <Input
            readOnly
            disabled={disabled}
            className="h-7 cursor-default border-transparent bg-muted/50 font-mono text-xs text-muted-foreground shadow-none focus-visible:ring-0"
            placeholder="https://api.example.com/data"
            value={config.url}
          />
        </div>
      </div>
      <div className="my-1 h-px bg-border" />
      {/* Field mapping */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label className="text-xs">Timestamp field</Label>
          <Input
            className="h-7 font-mono text-xs"
            placeholder="timestamp"
            value={config.timestampField}
            disabled={disabled}
            onChange={e => set('timestampField', e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">Value fields (comma-sep)</Label>
          <Input
            className="h-7 font-mono text-xs"
            placeholder="value, flow, pressure"
            value={config.valueFields.join(', ')}
            disabled={disabled}
            onChange={e =>
              set(
                'valueFields',
                e.target.value
                  .split(',')
                  .map(s => s.trim())
                  .filter(Boolean),
              )
            }
          />
        </div>
      </div>
      {/* Headers */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Headers</Label>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 gap-1 px-2 text-xs"
            disabled={disabled}
            onClick={addHeader}
          >
            <Plus className="h-3 w-3" />
            Add
          </Button>
        </div>
        {headerEntries.map(([k, v], i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Input
              className="h-6 flex-1 font-mono text-xs"
              placeholder="Key"
              value={k}
              disabled={disabled}
              onChange={e => setHeader(i, e.target.value, v)}
            />
            <Input
              className="h-6 flex-1 font-mono text-xs"
              placeholder="Value"
              value={v}
              disabled={disabled}
              onChange={e => setHeader(i, k, e.target.value)}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-6 w-6 shrink-0"
              disabled={disabled}
              onClick={() => removeHeader(k)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
