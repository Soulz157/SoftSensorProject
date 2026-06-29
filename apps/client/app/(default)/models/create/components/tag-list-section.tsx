'use client'

import { Checkbox } from '@/components/ui/checkbox'
import { useState } from 'react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MOCK_PI_TAGS } from '@/lib/mock-readings'
import type { ModelTag } from '@/lib/mock-model-create'

interface Props {
  tags: ModelTag[]
  disabled: boolean
  onToggle: (piTag: string) => void
}

export function TagListSection({ tags, disabled, onToggle }: Props) {
  const [query, setQuery] = useState('')
  const isSelected = (piTag: string) => tags.some(t => t.piTag === piTag)

  const q = query.trim().toLowerCase()
  const filtered = q
    ? MOCK_PI_TAGS.filter(
        t =>
          t.piTag.toLowerCase().includes(q) ||
          t.label.toLowerCase().includes(q),
      )
    : MOCK_PI_TAGS

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search tags…"
          aria-label="Search tags"
          disabled={disabled}
          className="h-9 w-full rounded-lg border border-input bg-transparent pl-9 pr-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
        />
      </div>

      <div className="space-y-2" role="group" aria-label="Model tags">
        {filtered.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">
            No tags match “{query}”.
          </p>
        ) : (
          filtered.map(tag => {
            const isOn = isSelected(tag.piTag)
            return (
              <div
                key={tag.piTag}
                className={cn(
                  'flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors',
                  isOn && 'border-primary/50 bg-accent',
                )}
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                  <Checkbox
                    checked={isOn}
                    disabled={disabled}
                    onCheckedChange={() => onToggle(tag.piTag)}
                    aria-label={`Select ${tag.piTag}`}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium text-foreground">
                        {tag.piTag}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {tag.label}
                      </span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {tag.unit}
                    </p>
                  </div>
                </label>

                {isOn && (
                  <span className="shrink-0 rounded-md border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
                    Input
                  </span>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
