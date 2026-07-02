'use client'

import { useState } from 'react'
import { Check, Plus, Signal, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { cn } from '@/lib/utils'
import { chartColorVar, resolveTagMeta } from '@/lib/mock-readings'

const MAX_VISIBLE_PILLS = 5

interface Props {
  available: string[]
  active: string[]
  onChange: (tags: string[] | null) => void
  disabled?: boolean
}

function toOverride(next: string[], available: string[]): string[] | null {
  const ordered = available.filter(t => next.includes(t))
  return ordered.length === available.length ? null : ordered
}

export function TagsSelector({ available, active, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string[]>(active)

  const visible = active.slice(0, MAX_VISIBLE_PILLS)
  const overflow = active.length - visible.length

  const handleOpenChange = (next: boolean) => {
    if (next) setDraft(active)
    setOpen(next)
  }

  const toggleDraft = (tag: string) =>
    setDraft(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag],
    )

  const commit = () => {
    onChange(toOverride(draft, available))
    setOpen(false)
  }

  const dismissPill = (tag: string) =>
    onChange(
      toOverride(
        active.filter(t => t !== tag),
        available,
      ),
    )

  return (
    <div className="space-y-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Signal className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">
            Tags
            <span className="ml-1.5 font-normal text-muted-foreground">
              {active.length} of {available.length}
            </span>
          </p>
        </div>

        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={disabled || available.length === 0}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Select Tags
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Select signals</DialogTitle>
              <DialogDescription>
                Choose which signals to display on the chart.
              </DialogDescription>
            </DialogHeader>

            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs text-muted-foreground">
                {draft.length} selected
              </span>
              <div className="flex items-center gap-1 ">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => setDraft(available)}
                  disabled={draft.length === available.length}
                >
                  Select all
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => setDraft([])}
                  disabled={draft.length === 0}
                >
                  Clear
                </Button>
              </div>
            </div>

            <Command className="rounded-lg ring-1 ring-foreground/10 gap-2">
              <CommandInput placeholder="Search signals…" />
              <CommandList className="max-h-60 overflow-y-auto px-1.5 py-1.5 ">
                <CommandEmpty>No signals found.</CommandEmpty>
                {available.map(tag => {
                  const meta = resolveTagMeta(tag)
                  const selected = draft.includes(tag)
                  return (
                    <CommandItem
                      key={tag}
                      value={`${tag} ${meta.label}`}
                      onSelect={() => toggleDraft(tag)}
                      className={cn(
                        'mb-2 last:mb-0',
                        'flex items-center gap-3',
                        'gap-5 rounded-lg border border-transparent px-3 py-2.5 text-sm text-foreground',
                        'transition-colors',
                        selected
                          ? 'border-primary/20 bg-primary/10'
                          : 'hover:bg-muted',
                      )}
                    >
                      <Check
                        className={cn(
                          'h-4 w-4 shrink-0 text-primary transition-opacity',
                          selected ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{
                          backgroundColor: chartColorVar(meta.chartIndex),
                        }}
                      />
                      <div className="grid flex-1 grid-cols-2 items-center gap-4">
                        <span className="truncate font-medium">{tag}</span>
                        <span className="truncate text-left text-xs text-muted-foreground">
                          {meta.label}
                          {meta.unit ? ` · ${meta.unit}` : ''}
                        </span>
                      </div>
                    </CommandItem>
                  )
                })}
              </CommandList>
            </Command>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={commit} disabled={draft.length === 0}>
                Apply ({draft.length})
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {active.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No signals selected — pick at least one to fetch.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {visible.map(tag => {
            const meta = resolveTagMeta(tag)
            return (
              <Badge key={tag} variant="secondary" className="gap-1.5 pr-1">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: chartColorVar(meta.chartIndex) }}
                />
                {tag}
                <button
                  type="button"
                  aria-label={`Remove ${tag}`}
                  onClick={() => dismissPill(tag)}
                  disabled={disabled}
                  className={cn(
                    'rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                    disabled && 'pointer-events-none opacity-50',
                  )}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )
          })}
          {overflow > 0 && (
            <Badge variant="outline" className="text-muted-foreground">
              +{overflow} more
            </Badge>
          )}
        </div>
      )}
    </div>
  )
}
