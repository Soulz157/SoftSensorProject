'use client'

import { useMemo, useState } from 'react'
import { CheckCircle2, Tags } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

interface Props {
  /** Tags that can be cleaned — the sidebar's `cleanableTags`. */
  candidates: string[]
  /** The cleaning batch (`dwCleaningTagsAtom`). */
  selected: string[]
  onChange: (next: string[]) => void
  /** Tags already saved as Cleaned, marked in the list. */
  cleanedTags: string[]
}

/**
 * DS-LAKE-032-D06. The cleaning batch, picked without the sidebar. It reads
 * and writes the SAME atom the sidebar's cleaning checkboxes do, so the two
 * never disagree and the "Cleaning Pipeline · N tags selected" header below
 * follows either one. An empty batch is allowed — that is how the sidebar
 * starts too — which is why the caller renders this outside the panel that
 * only mounts once a tag is selected.
 */
export function CleaningTagSelect({
  candidates,
  selected,
  onChange,
  cleanedTags,
}: Props) {
  const [query, setQuery] = useState('')
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const cleanedSet = useMemo(() => new Set(cleanedTags), [cleanedTags])

  // Selected first, then the rest, both filtered by the search box — the
  // same ordering `CompareTagsPopover` uses.
  const ordered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const match = (t: string) => !q || t.toLowerCase().includes(q)
    return [
      ...candidates.filter(t => selectedSet.has(t) && match(t)),
      ...candidates.filter(t => !selectedSet.has(t) && match(t)),
    ]
  }, [candidates, selectedSet, query])

  const toggle = (tag: string) =>
    onChange(
      selectedSet.has(tag)
        ? selected.filter(t => t !== tag)
        : // Kept in candidate order so the batch reads the same as the sidebar.
          candidates.filter(t => selectedSet.has(t) || t === tag),
    )

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-foreground">Tags to clean</span>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Tags to clean"
            className="h-8 gap-1.5 text-xs"
          >
            <Tags className="h-3.5 w-3.5" />
            {selected.length === 0
              ? 'Select tags'
              : `${selected.length} of ${candidates.length} selected`}
          </Button>
        </PopoverTrigger>
        {/* Never taller than the room the popover has on screen. */}
        <PopoverContent
          align="start"
          className="flex max-h-(--radix-popover-content-available-height) w-72 flex-col p-0"
        >
          <div className="space-y-2 border-b border-border p-2">
            <Input
              type="search"
              placeholder="Search tags..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="h-8 text-xs"
            />
            <div className="flex items-center justify-between">
              <button
                type="button"
                disabled={selected.length === candidates.length}
                onClick={() => onChange(candidates)}
                className="cursor-pointer text-[11px] text-primary disabled:cursor-default disabled:text-muted-foreground"
              >
                Select all
              </button>
              <button
                type="button"
                disabled={selected.length === 0}
                onClick={() => onChange([])}
                className="cursor-pointer text-[11px] text-primary disabled:cursor-default disabled:text-muted-foreground"
              >
                Clear
              </button>
            </div>
          </div>
          {/* A native scroll box, not ScrollArea: Radix's viewport only
              scrolls inside a FIXED height, so under `max-h` alone the list
              grew with every tag - 100+ tags ran the popover off the page
              (2026-10-19). */}
          <div
            data-testid="cleaning-tag-list"
            className="max-h-64 min-h-0 overflow-y-auto overscroll-contain"
          >
            <div className="space-y-0.5 p-1.5">
              {ordered.length === 0 ? (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                  No tags match
                </p>
              ) : (
                ordered.map(tag => (
                  <label
                    key={tag}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent"
                  >
                    <Checkbox
                      checked={selectedSet.has(tag)}
                      onCheckedChange={() => toggle(tag)}
                      className="shrink-0"
                    />
                    <span className="truncate font-mono">{tag}</span>
                    {cleanedSet.has(tag) && (
                      <span className="ml-auto flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                        <CheckCircle2 className="h-3 w-3" />
                        Cleaned
                      </span>
                    )}
                  </label>
                ))
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
