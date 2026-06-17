'use client'

import { cn } from '@/lib/utils'
import { MOCK_PI_TAGS, chartColorVar } from '@/lib/mock-readings'

interface Props {
  selected: string[]
  onToggle: (piTag: string) => void
}

export function TagSelector({ selected, onToggle }: Props) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="PI tags">
      {MOCK_PI_TAGS.map(tag => {
        const isOn = selected.includes(tag.piTag)
        return (
          <button
            key={tag.piTag}
            type="button"
            aria-pressed={isOn}
            onClick={() => onToggle(tag.piTag)}
            className={cn(
              'flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              isOn
                ? 'border-border bg-accent text-foreground'
                : 'border-border bg-card text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
          >
            <span
              className={cn(
                'h-2 w-2 shrink-0 rounded-full transition-opacity',
                !isOn && 'opacity-30',
              )}
              style={{ backgroundColor: chartColorVar(tag.chartIndex) }}
            />
            <span className="font-mono">{tag.piTag}</span>
            <span className="text-muted-foreground">{tag.label}</span>
          </button>
        )
      })}
    </div>
  )
}
