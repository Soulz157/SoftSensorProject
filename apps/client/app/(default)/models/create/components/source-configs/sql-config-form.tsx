'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { SQLConfig } from '@/store/model-pipeline'

interface Props {
  config: SQLConfig
  onChange: (config: SQLConfig) => void
  disabled?: boolean
}

export function SQLConfigForm({ config, onChange, disabled }: Props) {
  const set = <K extends keyof SQLConfig>(key: K, value: SQLConfig[K]) =>
    onChange({ ...config, [key]: value })

  return (
    <div className="space-y-2.5">
      <div className="grid gap-1.5">
        <Label className="text-xs">Connection String</Label>
        <Input
          className="h-7 font-mono text-xs"
          placeholder="Server=host;Database=db;User=u;Password=p"
          value={config.connectionString}
          disabled={disabled}
          onChange={e => set('connectionString', e.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs">Query</Label>
        <Textarea
          className="min-h-[72px] resize-none font-mono text-xs"
          placeholder="SELECT timestamp, tag, value FROM readings WHERE ..."
          value={config.query}
          disabled={disabled}
          onChange={e => set('query', e.target.value)}
        />
      </div>
    </div>
  )
}
