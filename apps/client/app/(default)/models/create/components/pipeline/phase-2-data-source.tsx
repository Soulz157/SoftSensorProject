'use client'

import { useRef } from 'react'
import { useAtom } from 'jotai'
import { Server, FileText, FileUp, PenLine, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { mpManualTagsRawAtom } from '@/store/model-pipeline'
import { DataSourcePicker } from './data-source-picker'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'
import type { TagInputMethod } from '@/store/model-pipeline'

interface Props {
  nav: UsePipelineNavResult
}

const isManual = (m: TagInputMethod) => m === 'csv' || m === 'text'

export function Phase2DataSource({ nav }: Props) {
  const [manualTagsRaw, setManualTagsRaw] = useAtom(mpManualTagsRawAtom)
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
      setManualTagsRaw(columns.join('\n'))
    }
    reader.readAsText(file)
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">
          How do you want to provide tags?
        </p>
        <p className="text-xs text-muted-foreground">
          Connect directly to a source, or supply tags manually via CSV or text.
        </p>
      </div>

      {/* Main path cards */}
      <div className="grid gap-3 sm:grid-cols-2">
        {/* Direct Data Source */}
        <button
          type="button"
          role="radio"
          aria-checked={nav.tagInputMethod === 'direct'}
          onClick={() => nav.setTagInputMethod('direct')}
          className={cn(
            'flex flex-col items-start gap-3 rounded-xl p-5 text-left transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            nav.tagInputMethod === 'direct'
              ? 'bg-primary/5 ring-2 ring-primary'
              : 'bg-card ring-1 ring-foreground/10 hover:bg-muted',
          )}
        >
          <span
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-lg transition-colors',
              nav.tagInputMethod === 'direct'
                ? 'bg-primary/15 text-primary'
                : 'bg-muted text-muted-foreground',
            )}
          >
            <Server className="h-5 w-5" />
          </span>
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-foreground">
              Direct Data Source
            </p>
            <p className="text-xs text-muted-foreground">
              Connect to PI / AVEVA, SQL, or API Gateway. Tags fetched directly
              — no mapping step.
            </p>
          </div>
        </button>

        {/* Manual Input */}
        <button
          type="button"
          role="radio"
          aria-checked={isManual(nav.tagInputMethod)}
          onClick={() => {
            if (!isManual(nav.tagInputMethod)) nav.setTagInputMethod('csv')
          }}
          className={cn(
            'flex flex-col items-start gap-3 rounded-xl p-5 text-left transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isManual(nav.tagInputMethod)
              ? 'bg-primary/5 ring-2 ring-primary'
              : 'bg-card ring-1 ring-foreground/10 hover:bg-muted',
          )}
        >
          <span
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-lg transition-colors',
              isManual(nav.tagInputMethod)
                ? 'bg-primary/15 text-primary'
                : 'bg-muted text-muted-foreground',
            )}
          >
            <FileText className="h-5 w-5" />
          </span>
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-foreground">
              Manual Input
            </p>
            <p className="text-xs text-muted-foreground">
              Upload a CSV or type tag names. You&apos;ll validate them against
              a source in the next step.
            </p>
          </div>
        </button>
      </div>

      {nav.tagInputMethod === 'direct' && (
        <div className="space-y-3 border-t border-border/60 pt-5">
          <DataSourcePicker nav={nav} />
        </div>
      )}

      {isManual(nav.tagInputMethod) && (
        <div className="space-y-4 border-t border-border/60 pt-5">
          <div className="flex items-center gap-1 rounded-lg bg-muted p-1 w-fit">
            <button
              type="button"
              onClick={() => nav.setTagInputMethod('csv')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                nav.tagInputMethod === 'csv'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <FileUp className="h-3.5 w-3.5" />
              Upload CSV
            </button>
            <button
              type="button"
              onClick={() => nav.setTagInputMethod('text')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                nav.tagInputMethod === 'text'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <PenLine className="h-3.5 w-3.5" />
              Type Tags
            </button>
          </div>

          {nav.tagInputMethod === 'csv' && (
            <div className="space-y-2">
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) handleCsvFile(file)
                }}
              />
              <button
                type="button"
                onClick={() => csvInputRef.current?.click()}
                className={cn(
                  'flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-8 transition-colors',
                  manualTagsRaw
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-border hover:border-primary/40',
                )}
              >
                <FileUp
                  className={cn(
                    'h-5 w-5',
                    manualTagsRaw ? 'text-primary' : 'text-muted-foreground',
                  )}
                />
                <p className="text-sm text-muted-foreground">
                  {manualTagsRaw
                    ? `${manualTagsRaw.split('\n').filter(Boolean).length} column(s) parsed — click to replace`
                    : 'Click to choose a .csv file'}
                </p>
              </button>
              {manualTagsRaw && (
                <p className="font-mono text-[11px] text-muted-foreground leading-relaxed line-clamp-3">
                  {manualTagsRaw.split('\n').filter(Boolean).join(', ')}
                </p>
              )}
            </div>
          )}

          {/* Text input */}
          {nav.tagInputMethod === 'text' && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                One tag per line, or comma-separated
              </p>
              <textarea
                value={manualTagsRaw}
                onChange={e => setManualTagsRaw(e.target.value)}
                placeholder={'TI-101\nVI-202\nPI-303'}
                rows={6}
                className="w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </div>
          )}

          {/* Callout */}
          <div className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2.5">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              In the next step, select a data source to validate your tags
              against.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
