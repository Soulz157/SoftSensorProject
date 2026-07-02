'use client'

import { useRef } from 'react'
import { Upload, FileCheck2 } from 'lucide-react'
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
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed py-4 transition-colors',
          hasFile
            ? 'border-primary/40 bg-primary/5'
            : 'border-border hover:border-primary/40 hover:bg-muted/50',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        {hasFile ? (
          <>
            <FileCheck2 className="h-5 w-5 text-primary" />
            <span className="font-mono text-xs text-foreground">
              {config.fileName}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {config.columns.length} columns · {config.rows.length} rows
            </span>
          </>
        ) : (
          <>
            <Upload className="h-5 w-5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              Click to upload CSV
            </span>
            <span className="text-[11px] text-muted-foreground">
              Column headers → auto-mapped as tag names
            </span>
          </>
        )}
      </button>

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
