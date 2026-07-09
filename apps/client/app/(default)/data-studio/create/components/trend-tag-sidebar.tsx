'use client'

import { AlertCircle, Info, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { chartColorVar, resolveTagMeta } from '@/lib/mock-readings'
import { Button } from '@/components/ui/button'

/** Optional breakdown of a tag's unified "Bad Data" count, shown in the
 * per-tag detail popover. If omitted for a tag, the popover falls back to
 * showing just the unified total from `badByTag`. */
export interface BadDataDetail {
  bad: number
  questionable: number
  reasons?: Array<{ label: string; count: number }>
}

interface Props {
  tags: string[]
  visibleTags: string[]
  hidden: Set<string>
  searchQuery: string
  /** Per-tag unified "Bad Data" row count (Bad + Questionable). */
  badByTag: Record<string, number>
  /** Per-tag breakdown (Bad vs Questionable, optional reasons) for the detail popover. */
  badDetailByTag?: Record<string, BadDataDetail>
  onToggle: (tag: string) => void
  onHoverTag: (tag: string | null) => void
}

export function TrendTagSidebar({
  tags,
  visibleTags,
  hidden,
  searchQuery,
  badByTag,
  badDetailByTag,
  onToggle,
  onHoverTag,
}: Props) {
  const filteredTags = tags.filter(t =>
    t.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  return (
    <div className="flex flex-col gap-3">
      {visibleTags.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No tags visible — check a tag below to plot it.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5 cursor-pointer">
          {visibleTags.map(tag => (
            <Badge
              key={tag}
              variant="secondary"
              className="gap-1.5 pr-1"
              onMouseEnter={() => onHoverTag(tag)}
              onMouseLeave={() => onHoverTag(null)}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{
                  backgroundColor: chartColorVar(
                    resolveTagMeta(tag).chartIndex,
                  ),
                }}
              />
              {tag}
              <button
                type="button"
                aria-label={`Hide ${tag}`}
                onClick={() => onToggle(tag)}
                className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-muted-foreground">
        <span className="mr-auto text-black">Tag Name</span>
        <span className="ml-auto flex-2">
          <p className="text-center mt-2 font-semibold text-black">Details</p>
          <p>Bad Data (Rows)</p>
        </span>
      </div>

      <ScrollArea className="h-105 rounded-lg border border-border">
        <div className="space-y-0.5 p-2">
          {filteredTags.map(tag => {
            const isHidden = hidden.has(tag)
            const badCount = badByTag[tag] ?? 0
            const detail = badDetailByTag?.[tag]
            return (
              <div
                key={tag}
                role="button"
                tabIndex={0}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
                onClick={() => onToggle(tag)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onToggle(tag)
                  }
                }}
                onMouseEnter={() => onHoverTag(tag)}
                onMouseLeave={() => onHoverTag(null)}
              >
                <Checkbox checked={!isHidden} className="pointer-events-none" />
                <span
                  className={cn(
                    'h-2.5 w-2.5 shrink-0 rounded-full transition-opacity',
                    isHidden && 'opacity-30',
                  )}
                  style={{
                    backgroundColor: chartColorVar(
                      resolveTagMeta(tag).chartIndex,
                    ),
                  }}
                />
                <span
                  className={cn(
                    'truncate font-mono text-xs',
                    isHidden ? 'text-muted-foreground/60' : 'text-foreground',
                  )}
                >
                  {tag}
                </span>
                {badCount > 0 && (
                  <div
                    className={cn(
                      'ml-auto flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                      isHidden
                        ? 'bg-muted text-muted-foreground/70'
                        : 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400',
                    )}
                    title={`${badCount} Bad/Questionable data points`}
                  >
                    <AlertCircle className="h-3 w-3" />
                    <span>{badCount}</span>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-auto h-6 w-6 p-0"
                          onClick={e => {
                            e.stopPropagation()
                          }}
                          aria-label={`View bad data detail for ${tag}`}
                        >
                          <Info className="h-3 w-3" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="end"
                        className="w-64 p-3"
                        onClick={e => e.stopPropagation()}
                      >
                        <div className="space-y-2">
                          <p className="font-mono text-xs font-semibold text-foreground">
                            {tag}
                          </p>

                          {detail ? (
                            <>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="rounded-md bg-muted px-2 py-1.5">
                                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                    Null
                                  </p>
                                  <p className="font-mono text-sm font-semibold text-foreground">
                                    {detail.bad}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground">
                                    rows
                                  </p>
                                </div>
                                <div className="rounded-md bg-muted px-2 py-1.5">
                                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                    Missing
                                  </p>
                                  <p className="font-mono text-sm font-semibold text-foreground">
                                    {detail.questionable}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground">
                                    rows
                                  </p>
                                </div>
                              </div>

                              {detail.reasons && detail.reasons.length > 0 && (
                                <div className="space-y-1 border-t border-border pt-2">
                                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                    Top reasons
                                  </p>
                                  <ul className="space-y-1">
                                    {detail.reasons.map(r => (
                                      <li
                                        key={r.label}
                                        className="flex items-center justify-between gap-2 text-[11px]"
                                      >
                                        <span className="truncate text-muted-foreground">
                                          {r.label}
                                        </span>
                                        <span className="shrink-0 font-mono font-medium text-foreground">
                                          {r.count}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </>
                          ) : (
                            <p className="text-[11px] text-muted-foreground">
                              <span className="font-mono font-semibold text-foreground">
                                {badCount}
                              </span>{' '}
                              row{badCount === 1 ? '' : 's'} flagged as Bad or
                              Questionable. Detailed breakdown not available for
                              this tag.
                            </p>
                          )}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                )}
              </div>
            )
          })}
          {filteredTags.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              No tags match &ldquo;{searchQuery}&rdquo;
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
