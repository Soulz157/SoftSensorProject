'use client'

import { useMemo, useState } from 'react'
import { Box } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import type { WorkspaceModel } from '@/types'

interface Props {
  models: WorkspaceModel[]
  selected: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
}

/**
 * MODEL-SERVE-022-D-FOCUS. The models a notification channel sends for — an
 * explicit allow-list, so the channel is silent for anything not ticked here.
 * Select all / Clear sit at the top; the form refuses to save an empty list.
 */
export function FocusModelSelect({
  models,
  selected,
  onChange,
  disabled,
}: Props) {
  const [query, setQuery] = useState('')
  const selectedSet = useMemo(() => new Set(selected), [selected])

  // Selected first, then the rest, both filtered by the search box.
  const ordered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const match = (m: WorkspaceModel) => !q || m.name.toLowerCase().includes(q)
    return [
      ...models.filter(m => selectedSet.has(m.id) && match(m)),
      ...models.filter(m => !selectedSet.has(m.id) && match(m)),
    ]
  }, [models, selectedSet, query])

  const allSelected = models.length > 0 && selected.length === models.length

  const toggle = (id: string) =>
    onChange(
      selectedSet.has(id)
        ? selected.filter(x => x !== id)
        : // Kept in the workspace's own model order.
          models
            .filter(m => selectedSet.has(m.id) || m.id === id)
            .map(m => m.id),
    )

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label="Focus models"
          disabled={disabled}
          className="h-9 w-full justify-start gap-2 text-sm font-normal"
        >
          <Box className="h-4 w-4 text-muted-foreground" />
          {selected.length === 0
            ? 'Select models'
            : allSelected
              ? `All models (${models.length})`
              : `${selected.length} of ${models.length} models`}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="space-y-2 border-b border-border p-2">
          <Input
            type="search"
            placeholder="Search models..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="h-8 text-xs"
          />
          <div className="flex items-center justify-between">
            <button
              type="button"
              disabled={allSelected}
              onClick={() => onChange(models.map(m => m.id))}
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
        <ScrollArea className="max-h-64">
          <div className="max-h-64 space-y-0.5 p-1.5">
            {ordered.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                No models match
              </p>
            ) : (
              ordered.map(m => (
                <label
                  key={m.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                >
                  <Checkbox
                    checked={selectedSet.has(m.id)}
                    onCheckedChange={() => toggle(m.id)}
                    className="shrink-0"
                  />
                  <span className="truncate">{m.name}</span>
                </label>
              ))
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
