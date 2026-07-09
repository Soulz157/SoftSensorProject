'use client'

import {
  CheckCircle2,
  ListFilter,
  PanelBottomClose,
  PanelBottomOpen,
  Search,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { ImputationTagRow } from '@/hooks/dataset/use-imputation-tag-list'

interface Props {
  rows: ImputationTagRow[]
  selectedTag: string | null
  query: string
  onQueryChange: (q: string) => void
  onSelectTag: (tag: string) => void
  isOpen: boolean
  onOpen: () => void
  onClose: () => void
}

function summaryText(row: ImputationTagRow): string {
  const { missing, suspect } = row.quality
  if (missing > 0 && suspect > 0)
    return `${missing} missing · ${suspect} suspect`
  if (missing > 0) return `${missing} missing`
  if (suspect > 0) return `${suspect} suspect`
  return 'Clean'
}

/** Left "master" panel of the Step 5.2 master-detail layout — search + per-tag status list. */
export function ImputationTagList({
  rows,
  selectedTag,
  query,
  onQueryChange,
  onSelectTag,
  isOpen,
  onOpen,
  onClose,
}: Props) {
  return (
    <div className="flex flex-col gap-3 lg:sticky lg:top-4 lg:self-start">
      <div className="flex items-center gap-2">
        <ListFilter className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">
          Tags to Cleaning
        </h3>
        <span className="flex h-5 items-center justify-center rounded-full bg-muted px-2 text-[10px] font-medium text-muted-foreground">
          {rows.length}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-7 w-7"
          onClick={isOpen ? onClose : onOpen}
          aria-label={isOpen ? 'Collapse tag list' : 'Expand tag list'}
        >
          {isOpen ? (
            <PanelBottomClose className="h-4 w-4" />
          ) : (
            <PanelBottomOpen className="h-4 w-4" />
          )}
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          placeholder="Search tags…"
          className="h-9 pl-8 text-xs"
        />
      </div>
      {isOpen && (
        <ScrollArea className="h-105 rounded-lg border border-border">
          <div className="space-y-1 p-2">
            {rows.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                No tags match &quot;{query}&quot;
              </p>
            ) : (
              rows.map(row => {
                const isSelected = row.tag === selectedTag
                return (
                  <button
                    key={row.tag}
                    type="button"
                    onClick={() => onSelectTag(row.tag)}
                    aria-pressed={isSelected}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors',
                      isSelected
                        ? 'bg-accent/50 text-foreground ring-1 ring-primary/30'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    <span
                      className={cn(
                        'h-2 w-2 shrink-0 rounded-full',
                        row.severity === 'missing' && 'bg-destructive',
                        row.severity === 'suspect' && 'bg-amber-500',
                        row.severity === 'clean' && 'bg-transparent',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-xs">{row.tag}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {summaryText(row)}
                      </p>
                    </div>
                    {row.completed && (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                    )}
                  </button>
                )
              })
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
