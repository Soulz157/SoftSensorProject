'use client'

import { useState } from 'react'
import { ChevronDown, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ZeroReadingTag } from '@/lib/zero-readings'

/** Tags named inline before the rest fold behind "+N more". */
const INLINE_TAGS = 3

interface Props {
  /** Most zero-heavy first (`zeroSuggestions` sorts them). */
  suggestions: ZeroReadingTag[]
  onTreatAsMissing: () => void
}

/**
 * The "zeros treated as missing" suggestion (lib/zero-readings.ts), kept to
 * three lines however many tags it covers (2026-10-19): it used to list every
 * tag on its own line with full counts, which with dozens of zero-heavy tags
 * pushed the Cleaning Toolkit off screen. The worst three are named inline,
 * the rest open on demand in a capped list, and exact counts live in each
 * tag's tooltip. Neutral styling: 0 can be a real reading.
 */
export function ZeroReadingsNotice({ suggestions, onTreatAsMissing }: Props) {
  const [expanded, setExpanded] = useState(false)
  if (suggestions.length === 0) return null

  const inline = suggestions.slice(0, INLINE_TAGS)
  const more = suggestions.length - inline.length
  const pct = (z: ZeroReadingTag) => `${Math.round(z.share * 100)}%`
  const counts = (z: ZeroReadingTag) =>
    `${z.zeros.toLocaleString()} of ${z.readings.toLocaleString()} loaded readings are exactly 0`

  return (
    <div className="space-y-1.5 rounded-xl border border-border bg-card/50 px-4 py-3 text-xs">
      <div className="flex items-center gap-2">
        <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 font-medium text-foreground">
          {suggestions.length === 1
            ? '1 tag reads exactly 0 often'
            : `${suggestions.length} tags read exactly 0 often`}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onTreatAsMissing}
          className="h-7 shrink-0 text-xs"
        >
          Treat zeros as missing
        </Button>
      </div>

      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-5.5 text-muted-foreground">
        {inline.map(z => (
          <span key={z.tag} title={counts(z)} className="truncate">
            <span className="font-mono text-foreground">{z.tag}</span> {pct(z)}
          </span>
        ))}
        {more > 0 && (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded(e => !e)}
            className="inline-flex items-center gap-0.5 text-foreground underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {expanded ? 'Show less' : `+${more} more`}
            <ChevronDown
              className={cn(
                'h-3 w-3 transition-transform',
                expanded && 'rotate-180',
              )}
            />
          </button>
        )}
      </p>

      {expanded && more > 0 && (
        <ul
          data-testid="zero-readings-more"
          className="ml-5.5 max-h-40 space-y-0.5 overflow-y-auto overscroll-contain rounded-md border border-border p-2 text-muted-foreground"
        >
          {suggestions.slice(INLINE_TAGS).map(z => (
            <li key={z.tag} title={counts(z)} className="flex gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-foreground">
                {z.tag}
              </span>
              <span className="tabular-nums">{pct(z)}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="pl-5.5 text-[11px] text-muted-foreground">
        Only if 0 means the instrument dropped out, not a real reading such as a
        closed valve.
      </p>
    </div>
  )
}
