'use client'

import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { MOCK_PI_TAGS } from '@/lib/mock-readings'
import type { ModelTag } from '@/lib/mock-model-create'

interface Props {
  tags: ModelTag[]
  disabled: boolean
  onToggle: (piTag: string) => void
}

export function TagListSection({ tags, disabled, onToggle }: Props) {
  const isSelected = (piTag: string) => tags.some(t => t.piTag === piTag)

  return (
    <div className="space-y-2" role="group" aria-label="Model tags">
      {MOCK_PI_TAGS.map(tag => {
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
      })}
    </div>
  )
}
