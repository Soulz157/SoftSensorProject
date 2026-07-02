'use client'

import { useEffect, useRef, useState } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { FileUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  mpCsvUploadTagsAtom,
  mpSavedDataSourcesAtom,
} from '@/store/model-pipeline'
import { useDataSources } from '@/hooks/use-data-sources'
import { DataSourcePicker } from '../data-source-picker'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'

interface Props {
  nav: UsePipelineNavResult
}

export function Phase2DataSource({ nav }: Props) {
  const [csvUploadTags, setCsvUploadTags] = useAtom(mpCsvUploadTagsAtom)
  const setSavedSources = useSetAtom(mpSavedDataSourcesAtom)
  const { sources, loading } = useDataSources()

  useEffect(() => {
    if (!loading) setSavedSources(sources)
  }, [sources, loading, setSavedSources])
  const [csvFileName, setCsvFileName] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const csvInputRef = useRef<HTMLInputElement>(null)

  const handleCsvFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = e => {
      const text = (e.target?.result as string | null) ?? ''
      const firstLine = text.split('\n')[0] ?? ''
      const columns = firstLine
        .split(',')
        .map(c => c.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
      setCsvUploadTags(columns)
      setCsvFileName(file.name)
    }
    reader.readAsText(file)
  }

  return (
    <div className="space-y-6">
      {/* Data source multi-select */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-foreground">
            Select Data Sources
          </p>
          <p className="text-xs text-muted-foreground">
            Multiple selections allowed
          </p>
        </div>
        <DataSourcePicker nav={nav} multiple={true} />
      </div>

      {/* CSV supplement */}
      <div className="space-y-3 border-t border-border/60 pt-5">
        <div>
          <p className="text-sm font-medium text-foreground">
            Supplement with CSV{' '}
            <span className="text-xs font-normal text-muted-foreground">
              (optional)
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            Tag column headers from the first row will be imported.
          </p>
        </div>

        <input
          ref={csvInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) handleCsvFile(file)
            e.target.value = ''
          }}
        />

        <button
          type="button"
          onClick={() => csvInputRef.current?.click()}
          onDragOver={e => {
            e.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={e => {
            e.preventDefault()
            setIsDragging(false)
            const file = e.dataTransfer.files[0]
            if (file) handleCsvFile(file)
          }}
          className={cn(
            'flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-8 transition-colors',
            isDragging
              ? 'border-primary bg-primary/5'
              : csvUploadTags.length > 0
                ? 'border-primary/40 bg-primary/5'
                : 'border-border hover:border-primary/40 hover:bg-muted/40',
          )}
        >
          <FileUp
            className={cn(
              'h-5 w-5',
              csvUploadTags.length > 0 || isDragging
                ? 'text-primary'
                : 'text-muted-foreground',
            )}
          />
          <p className="text-sm text-muted-foreground">
            {csvUploadTags.length > 0
              ? `${csvUploadTags.length} column(s) from ${csvFileName ?? 'CSV'} — click to replace`
              : isDragging
                ? 'Drop to import columns'
                : 'Drag & drop or click to choose a .csv file'}
          </p>
        </button>

        {csvUploadTags.length > 0 && (
          <p className="line-clamp-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {csvUploadTags.join(', ')}
          </p>
        )}
      </div>
    </div>
  )
}
