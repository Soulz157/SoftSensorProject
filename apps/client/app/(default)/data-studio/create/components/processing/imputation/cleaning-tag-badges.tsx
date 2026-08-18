'use client'

import { X } from 'lucide-react'
import { chartColorVar, resolveTagMeta } from '@/lib/mock-readings'

interface Props {
  tags: string[]
  onRemove: (tag: string) => void
}

/**
 * Focused-tags indicator for Step 3.2. Renders the current cleaning-target set
 * as removable pills plus a running count — the header twin of the sidebar
 * checkboxes (both mutate `dwCleaningTagsAtom`).
 */
export function CleaningTagBadges({ tags, onRemove }: Props) {
  if (tags.length === 0) return null

  return (
    <div className="space-y-2 rounded-xl border border-border bg-card/50 p-3">
      <p className="text-xs font-medium text-muted-foreground">
        Applying strategies to{' '}
        <span className="font-semibold text-foreground">{tags.length}</span>{' '}
        selected {tags.length === 1 ? 'tag' : 'tags'}.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {tags.map(tag => (
          <span
            key={tag}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background py-0.5 pr-1 pl-2 text-xs"
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{
                backgroundColor: chartColorVar(resolveTagMeta(tag).chartIndex),
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
    </div>
  )
}
