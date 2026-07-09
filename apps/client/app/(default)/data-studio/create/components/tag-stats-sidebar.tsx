'use client'

import { useEffect, useState } from 'react'
import { ListFilter, Plus, Sigma } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { TagStatRow } from '@/hooks/use-tag-stats'
import { StatTile } from './stat-tile'
import { Button } from '@/components/ui/button'

interface Props {
  stats: TagStatRow[]
  mode: 'single' | 'multi'
  selectedTag: string
  onSelectTag: (tag: string) => void
  selectedRow: TagStatRow | undefined
  selectedTags: string[]
  onToggleTag: (tag: string) => void
  onSetSelectedTags?: (tags: string[]) => void
}

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export function TagStatsSidebar({
  stats,
  mode,
  selectedTag,
  onSelectTag,
  selectedRow,
  selectedTags,
  onSetSelectedTags,
  onToggleTag,
}: Props) {
  const canMultiSelect = mode === 'multi'
  const [multiSelectOn, setMultiSelectOn] = useState(false)
  const isMultiActive = canMultiSelect && multiSelectOn

  useEffect(() => {
    if (!canMultiSelect) setMultiSelectOn(false)
  }, [canMultiSelect])

  const footerRows: TagStatRow[] =
    mode === 'multi'
      ? selectedTags
          .map(tag => stats.find(s => s.tag === tag))
          .filter((s): s is TagStatRow => s !== undefined)
      : selectedRow
        ? [selectedRow]
        : []

  function handleToggleMultiSelect() {
    if (!canMultiSelect) return
    const next = !multiSelectOn
    setMultiSelectOn(next)
    if (!next && selectedTags.length > 1) {
      const keep = selectedTags[selectedTags.length - 1]
      selectedTags.forEach(t => {
        if (t !== keep) onToggleTag(t)
      })
    }
  }

  function handleTagClick(tag: string) {
    if (!canMultiSelect) {
      onSelectTag(tag)
      if (onSetSelectedTags) onSetSelectedTags([tag])
      return
    }

    if (isMultiActive) {
      onToggleTag(tag)
      return
    }

    onSelectTag(tag)
    if (onSetSelectedTags) {
      onSetSelectedTags([tag])
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ListFilter className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Tags</h3>
          <span className="flex h-5 items-center justify-center rounded-full bg-muted px-2 text-[10px] font-medium text-muted-foreground">
            {stats.length}
          </span>
        </div>

        {canMultiSelect && (
          <Button
            variant={isMultiActive ? 'secondary' : 'ghost'}
            size="sm"
            onClick={handleToggleMultiSelect}
            aria-pressed={isMultiActive}
            className={cn(
              'h-7 gap-1.5 px-2 text-xs cursor-pointer',
              isMultiActive && 'bg-secondary',
            )}
          >
            <Plus
              className={cn(
                'h-3.5 w-3.5 transition-transform duration-200',
                isMultiActive && 'rotate-45',
              )}
            />
            Multi Select
          </Button>
        )}
      </div>

      <ScrollArea className="h-105 rounded-lg border border-border">
        <div className="space-y-1 p-2">
          {stats.map(stat => {
            const isSelected = canMultiSelect
              ? selectedTags.includes(stat.tag)
              : stat.tag === selectedTag
            const atCap =
              isMultiActive && !isSelected && selectedTags.length >= 3

            return (
              <button
                key={stat.tag}
                type="button"
                onClick={() => handleTagClick(stat.tag)}
                aria-pressed={isSelected}
                disabled={atCap}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left font-mono text-xs transition-colors',
                  isSelected
                    ? 'bg-accent/50 text-foreground ring-1'
                    : atCap
                      ? 'text-muted-foreground/40'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
                style={
                  isSelected
                    ? ({ '--tw-ring-color': stat.fill } as React.CSSProperties)
                    : undefined
                }
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: stat.fill }}
                />
                <span className="truncate">{stat.tag}</span>
              </button>
            )
          })}
        </div>
      </ScrollArea>

      <div className="flex items-center gap-2 pt-1">
        <Sigma className="h-3.5 w-3.5 text-muted-foreground" />
        <h4 className="text-xs font-medium text-muted-foreground">
          {footerRows.length > 1 ? 'Stats' : (footerRows[0]?.tag ?? 'Stats')}
        </h4>
      </div>
      {footerRows.length === 0 ? (
        <div className="grid grid-cols-3 gap-2">
          <StatTile label="Mean" value="—" surface="muted" valueSize="sm" />
          <StatTile label="Median" value="—" surface="muted" valueSize="sm" />
          <StatTile label="SD" value="—" surface="muted" valueSize="sm" />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {footerRows.map(row => (
            <div key={row.tag} className="space-y-1.5">
              {footerRows.length > 1 && (
                <div className="flex items-center gap-1.5">
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: row.fill }}
                  />
                  <span
                    className="truncate font-mono text-[10px] font-medium tracking-wide uppercase"
                    style={{ color: row.fill }}
                  >
                    {row.tag}
                  </span>
                </div>
              )}
              <div
                className={cn(
                  'grid grid-cols-3 gap-2',
                  footerRows.length > 1 && 'rounded-md border-l-2 pl-2',
                )}
                style={
                  footerRows.length > 1 ? { borderColor: row.fill } : undefined
                }
              >
                <StatTile
                  label="Mean"
                  value={fmt(row.mean)}
                  surface="muted"
                  valueSize="sm"
                />
                <StatTile
                  label="Median"
                  value={fmt(row.median)}
                  surface="muted"
                  valueSize="sm"
                />
                <StatTile
                  label="SD"
                  value={fmt(row.std)}
                  surface="muted"
                  valueSize="sm"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
