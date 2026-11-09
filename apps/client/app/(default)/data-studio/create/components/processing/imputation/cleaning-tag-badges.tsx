'use client'

import { useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { chartColorVar, resolveTagMeta } from '@/lib/mock-readings'

/** Up to this many tags the pills show without a toggle (about two rows). */
export const CLEANING_BADGES_COLLAPSE_FROM = 12

interface Props {
  tags: string[]
  onRemove: (tag: string) => void
}

/**
 * Focused-tags indicator for Step 3.2. Renders the current cleaning-target set
 * as removable pills plus a running count — the header twin of the sidebar
 * checkboxes (both mutate `dwCleaningTagsAtom`).
 *
 * Past CLEANING_BADGES_COLLAPSE_FROM tags the pills fold behind "View tags"
 * (2026-10-19): 128 pills ran to dozens of rows and pushed the pipeline off
 * screen, and the same batch is already editable in `CleaningTagSelect` and
 * the sidebar, so folding it costs nothing.
 */
export function CleaningTagBadges({ tags, onRemove }: Props) {
  const [expanded, setExpanded] = useState(false)
  if (tags.length === 0) return null

  const collapsible = tags.length > CLEANING_BADGES_COLLAPSE_FROM
  const showPills = !collapsible || expanded

  return (
    <div className="space-y-2 rounded-xl border border-border bg-card/50 p-3">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-xs font-medium text-muted-foreground">
          Applying strategies to{' '}
          <span className="font-semibold text-foreground">{tags.length}</span>{' '}
          selected {tags.length === 1 ? 'tag' : 'tags'}.
        </p>
        {collapsible && (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls="cleaning-tag-badges"
            onClick={() => setExpanded(e => !e)}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1 text-xs font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {expanded ? 'Hide tags' : 'View tags'}
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 transition-transform',
                expanded && 'rotate-180',
              )}
            />
          </button>
        )}
      </div>
      {showPills && (
        <div
          id="cleaning-tag-badges"
          className={cn(
            'flex flex-wrap gap-1.5',
            collapsible && 'max-h-40 overflow-y-auto overscroll-contain',
          )}
        >
          {tags.map(tag => (
            <span
              key={tag}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background py-0.5 pr-1 pl-2 text-xs"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{
                  backgroundColor: chartColorVar(
                    resolveTagMeta(tag).chartIndex,
                  ),
                }}
              />
              <span className="font-mono">{tag}</span>
              <button
                type="button"
                onClick={() => onRemove(tag)}
                aria-label={`Remove ${tag} from cleaning`}
                className="flex h-4 w-4 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
