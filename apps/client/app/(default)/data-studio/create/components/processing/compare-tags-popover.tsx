'use client'

import { useMemo, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { MAX_COMPARE } from '@/hooks/dataset/use-compare-tags'

interface Props {
  activeTags: string[]
  compareTags: string[]
  toggle: (tag: string) => void
  atCap: boolean
  colorForTag: (tag: string) => string
}

/**
 * "Compare Tags (Max 5)" control for the Data Analysis card. Chooses which tags
 * overlay the Histogram / Box Plot + appear in the stat table — a capped subset
 * of the sidebar's active tags, so the plots stay legible on large datasets.
 */
export function CompareTagsPopover({
  activeTags,
  compareTags,
  toggle,
  atCap,
  colorForTag,
}: Props) {
  const [query, setQuery] = useState('')
  const selected = useMemo(() => new Set(compareTags), [compareTags])

  // Selected tags first (clear current-state), then the rest; filtered by search.
  const ordered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const inQuery = (t: string) => (q ? t.toLowerCase().includes(q) : true)
    const sel = compareTags.filter(inQuery)
    const rest = activeTags.filter(t => !selected.has(t) && inQuery(t))
    return [...sel, ...rest]
  }, [activeTags, compareTags, selected, query])

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 rounded-full text-xs"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Compare Tags: {compareTags.length}/{MAX_COMPARE}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="border-b border-border p-2">
          <Input
            type="search"
            placeholder="Search tags..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <ScrollArea className="max-h-64">
          <div className="space-y-0.5 p-1.5">
            {ordered.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                No tags match
              </p>
            ) : (
              ordered.map(tag => {
                const isSelected = selected.has(tag)
                const disabled = !isSelected && atCap
                const row = (
                  <label
                    className={cn(
                      'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs',
                      disabled
                        ? 'cursor-not-allowed opacity-50'
                        : 'cursor-pointer hover:bg-accent',
                    )}
                  >
                    <Checkbox
                      checked={isSelected}
                      disabled={disabled}
                      onCheckedChange={() => !disabled && toggle(tag)}
                      className="shrink-0"
                    />
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: colorForTag(tag) }}
                    />
                    <span className="truncate font-mono">{tag}</span>
                  </label>
                )
                return disabled ? (
                  <Tooltip key={tag}>
                    <TooltipTrigger asChild>{row}</TooltipTrigger>
                    <TooltipContent side="left">
                      Maximum of {MAX_COMPARE} tags reached. Deselect a tag to
                      add another.
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <div key={tag}>{row}</div>
                )
              })
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
