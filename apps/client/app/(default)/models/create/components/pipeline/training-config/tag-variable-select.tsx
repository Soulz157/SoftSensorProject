'use client'

import { useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
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

interface Props {
  tags: string[]
  targetVariables: string[]
  onTargetChange: (next: string[]) => void
  disabled?: boolean
}

export function TargetVariableSelector({
  tags,
  targetVariables,
  onTargetChange,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string | null>(targetVariables[0] ?? null)

  // Same reset TagsSelector does on open: the dialog is a DRAFT surface, so
  // a cancelled edit must not leak into the next open.
  const handleOpenChange = (next: boolean) => {
    if (next) setDraft(targetVariables[0] ?? null)
    setOpen(next)
  }

  // max === 1 semantics, matching TagsSelector's toggleDraft: a new pick
  // REPLACES rather than being blocked, so the user never has to deselect
  // first. Re-picking the same tag clears it.
  const toggleDraft = (tag: string) =>
    setDraft(prev => (prev === tag ? null : tag))

  const commit = () => {
    onTargetChange(draft ? [draft] : [])
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          disabled={disabled || tags.length === 0}
          className="h-9 w-full justify-between text-sm font-normal"
        >
          <span
            className={cn(
              'truncate',
              !targetVariables[0] && 'text-muted-foreground',
            )}
          >
            {targetVariables[0] ?? 'Select a tag to predict'}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Select Target Variable</DialogTitle>
          <DialogDescription>
            Choose the tag the model will predict. Exactly one.
          </DialogDescription>
        </DialogHeader>

        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {draft ? '1 selected' : 'None selected'}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => setDraft(null)}
            disabled={!draft}
          >
            Clear
          </Button>
        </div>

        <Command className="gap-2 rounded-lg ring-1 ring-foreground/10">
          <CommandInput placeholder="Search signals…" />
          <CommandList className="max-h-60 overflow-y-auto px-1.5 py-1.5">
            <CommandEmpty>
              {tags.length === 0
                ? 'No dataset tags available.'
                : 'No signals found.'}
            </CommandEmpty>
            {tags.map(tag => {
              const meta = resolveTagMeta(tag)
              const selected = draft === tag
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
                    style={{ backgroundColor: chartColorVar(meta.chartIndex) }}
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
          <Button onClick={commit} disabled={!draft}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
