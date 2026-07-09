'use client'

import { useRef } from 'react'
import { Upload, FileCheck2, FileX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { CSVConfig } from '@/store/model-pipeline'

interface Props {
  config: CSVConfig
  onChange: (config: CSVConfig) => void
  disabled?: boolean
}

function parseCSV(text: string): {
  columns: string[]
  rows: Record<string, string>[]
} {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return { columns: [], rows: [] }
  const columns =
    lines[0]?.split(',').map(c => c.trim().replace(/^"|"$/g, '')) || []
  const rows = lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''))
    return Object.fromEntries(columns.map((c, i) => [c, vals[i] ?? '']))
  })
  return { columns, rows }
}

export function CSVConfigForm({ config, onChange, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      const { columns, rows } = parseCSV(text)
      onChange({ ...config, fileName: file.name, columns, rows })
    }
    reader.readAsText(file)
  }

  const hasFile = !!config.fileName

  return (
    <div className="space-y-2.5">
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        disabled={disabled}
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) handleFile(f)
        }}
      />
      <div
        className={cn(
          'flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2',
          disabled && 'opacity-50',
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          {hasFile ? (
            <FileCheck2 className="h-4 w-4 shrink-0 text-primary" />
          ) : (
            <FileX className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span
            className={cn(
              'truncate font-mono text-xs',
              hasFile ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {hasFile ? config.fileName : 'No file uploaded'}
          </span>
          {hasFile && (
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {config.columns.length} cols · {config.rows.length} rows
            </span>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 shrink-0 gap-1.5 px-2.5 text-xs"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="h-3.5 w-3.5" />
          {hasFile ? 'Replace File' : 'Upload File'}
        </Button>
      </div>

      {/* Preview columns as tags */}
      {config.columns.length > 0 && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            Auto-detected tags
          </Label>
          <div className="flex flex-wrap gap-1">
            {config.columns.map(col => (
              <span
                key={col}
                className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]"
              >
                {col}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
