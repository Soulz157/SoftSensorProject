'use client'

import { Check, Plus, Search, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  MOCK_PI_TAGS,
  SOURCE_TAG_STATUS,
  sourceStatusMeta,
  type PiTagEntry,
} from '@/lib/csv-tag-mapping-shared'

interface Props {
  sourceQuery: string
  setSourceQuery: (v: string) => void
  filteredSourceTags: PiTagEntry[]
  nameSet: Set<string>
  safeInserted: string[]
  onInsert: (piTag: string) => void
  onRemoveInserted: (piTag: string) => void
}

export function CsvSourceBrowser({
  sourceQuery,
  setSourceQuery,
  filteredSourceTags,
  nameSet,
  safeInserted,
  onInsert,
  onRemoveInserted,
}: Props) {
  return (
    <div className="flex flex-col">
      <div className="space-y-2 border-b border-border/60 px-3 py-2.5">
        <p className="text-xs font-semibold text-foreground">Source Browser</p>
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-2 py-1.5">
          <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search source tags…"
            value={sourceQuery}
            onChange={e => setSourceQuery(e.target.value)}
            className="flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
          />
          {sourceQuery && (
            <button
              type="button"
              onClick={() => setSourceQuery('')}
              aria-label="Clear source search"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <XCircle className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      <div className="max-h-64 divide-y divide-border/40 overflow-y-auto">
        {filteredSourceTags.length === 0 && (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">
            No tags match
          </p>
        )}
        {filteredSourceTags.map(tag => {
          const inList = nameSet.has(tag.piTag.toLowerCase())
          const isInserted = safeInserted.includes(tag.piTag)
          const status = SOURCE_TAG_STATUS[tag.piTag] ?? 'Good'
          const statusMeta = sourceStatusMeta(status)
          const canRemove = isInserted
          return (
            <div
              key={tag.piTag}
              className={cn(
                'flex items-center gap-2 px-3 py-2 transition-colors',
                inList ? 'bg-emerald-500/5' : 'hover:bg-muted/40',
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-xs font-medium text-foreground">
                  {tag.piTag}
                </p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {tag.label} · {tag.unit}
                </p>
              </div>
              <span
                className={cn(
                  'flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                  statusMeta.classes,
                )}
              >
                <span
                  className={cn('h-1.5 w-1.5 rounded-full', statusMeta.dot)}
                />
                {statusMeta.label}
              </span>
              <button
                type="button"
                disabled={inList && !canRemove}
                onClick={() =>
                  canRemove ? onRemoveInserted(tag.piTag) : onInsert(tag.piTag)
                }
                title={
                  inList && !canRemove
                    ? 'Already in tag list'
                    : canRemove
                      ? 'Remove from tag list'
                      : 'Add to tag list'
                }
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors',
                  inList
                    ? 'bg-emerald-500/15 text-emerald-600 enabled:hover:bg-rose-500/15 enabled:hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-70'
                    : 'bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary',
                )}
              >
                {inList ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <Plus className="h-3 w-3" />
                )}
              </button>
            </div>
          )
        })}
      </div>

      <div className="border-t border-border/60 px-3 py-1.5">
        <p className="text-[10px] text-muted-foreground">
          {MOCK_PI_TAGS.length} tags · {safeInserted.length} added
        </p>
      </div>
    </div>
  )
}
